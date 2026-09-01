# MIRA SCALE & INFRASTRUCTURE DOSSIER — 31 August 2026

**For the judge and the jury. Prepared ahead of an owner purchase decision.**

Every figure is labelled **VERIFIED** (measured on the production host today) or **INFERRED**
(reasoned from a measurement, stated as an estimate). Nothing here is assumed.

---

## THE HEADLINE, BEFORE YOU SPEND ANYTHING

**You cannot put an autoscaling group behind a load balancer in front of this. It will not
work, and buying one would be money set on fire.**

That is not a limitation of the code. It is the nature of the product you chose to build.
The reason is one line:

```js
const sessions = new Map();        // whatsapp-gateway-v2.mjs:313
```

Each customer pairs **their own WhatsApp account**. The gateway holds a long-lived,
authenticated WebSocket to WhatsApp **per customer**, plus their encrypted auth state, in
that in-process Map. A customer is not a request. A customer is a **resident**.

A load balancer distributes *stateless requests* across *interchangeable workers*. Neither
half of that sentence is true here. Customer #400's messages can only ever be served by the
one process holding customer #400's socket. Route them anywhere else and there is nothing
there to answer with.

**What you actually need to buy is sharding, not balancing.** They cost differently, they
scale differently, and confusing them is the single most expensive mistake available to you
right now.

---

## 1. WHAT EXISTS TODAY — VERIFIED

One virtual machine. `23.88.59.31`, hostname `mira`.

| | |
|---|---|
| CPU | Intel Xeon (Skylake, IBRS), **2 cores** |
| RAM | **3.7 GiB** total, 815 MiB used, 2.9 GiB available |
| Disk | 38 GB, 7.6 GB used (22%) |
| Load average | **0.00, 0.00, 0.00** |

**Everything runs on it.** Not the app tier — *everything*:

```
mira-whatsapp.service       RSS 145 MB
mira-bot.service            RSS 100 MB
postgresql@16-main.service  ← the database, same box
```

There is no second machine. No replica, no standby, no load balancer, no backup host.
**If this VM is lost, every tenant loses service and the only copy of the fact ledger,
the conversation memory, the encrypted DEKs and every paired WhatsApp session goes with it.**

That is the finding the jury should weigh most heavily. Not throughput — *survival*.

---

## 2. WHERE HER BRAIN ACTUALLY IS — VERIFIED

**The brain is not on this machine and never was.**

The running process carries `OPENROUTER_API_KEY`. Inference is a remote API call to
OpenRouter. The VM runs the two gateways and the database; it does no model inference at all.

This is the most important correction to the question as asked. There is no "brain sitting
somewhere" that needs an autoscaler, because **the brain is already someone else's elastic
infrastructure.** OpenRouter absorbs concurrency for you today.

That splits your scaling problem cleanly in two, and they are **not the same problem**:

| | scales by | limit is | who pays |
|---|---|---|---|
| **The brain** (LLM) | someone else's capacity | rate limits + **cost per token** | you, per message |
| **The body** (gateways, DB, sessions) | machines you buy | **RAM per resident session** | you, per month |

**The brain does not need infrastructure. It needs a budget.** The body is what you buy.

---

## 3. THE REAL CEILING — MEASURED, THEN ESTIMATED

**VERIFIED:** with **one** paired customer, `mira-whatsapp` holds **145 MB** RSS.

**INFERRED, and the number the purchase turns on:** a Baileys session carries crypto keys,
prekeys, an app-state cache and a message buffer per customer. Taking a deliberately wide
band of **8–25 MB per additional resident session**, against ~2.9 GiB free *shared with
PostgreSQL*:

| customers | est. gateway RAM | verdict on THIS box |
|---|---|---|
| 10 | ~0.25 GB | comfortable |
| 50 | ~0.7 GB | workable |
| **100** | **~1.3 GB** | **contended with Postgres** |
| 250 | ~3 GB | **exceeds the machine** |

**This band is an estimate and must be replaced with a measurement before you scale.** The
honest statement is: *nobody knows the real per-session cost yet, because only one session
has ever existed.* Section 7 says how to find out for the price of an afternoon.

**But the CPU is not the constraint and will not be.** Load average is 0.00 across all three
windows. This workload is I/O-bound: it waits on WhatsApp, on Postgres and on OpenRouter.
**You are buying RAM and redundancy, not cores.** Do not let anyone sell you a 16-core box.

---

## 4. WHAT THE MOVEMENTS OF PEOPLE ACTUALLY LOOK LIKE

The jury asked how this behaves under real human traffic. Three properties dominate, and none
of them is average throughput:

**(a) People are bursty and correlated.** Messaging traffic is not uniform — it clusters at
waking, lunch and late evening, *in each customer's own timezone*. A system sized for the mean
fails at the peak. Size for the peak hour, not the daily average.

**(b) A resident costs money while asleep.** This is the property that makes this product
different from a web app. A customer who sends **nothing for a week** still holds a socket,
still holds keys, still holds RAM. **Your cost floor is set by how many people have SIGNED UP,
not by how many are talking.** A web app with 10,000 idle users costs nothing. Ten thousand
idle Mira customers cost ten thousand resident sessions.

**(c) The tail is where trust dies.** One customer with a broken pairing, an expired session
or a wedged socket does not degrade gracefully — that individual gets *nothing*, while every
dashboard stays green. Per-customer health is the metric that matters. Aggregate uptime will
lie to you.

**Consequence for the purchase:** capacity planning is **per signed-up customer**, not per
message. Price the plan accordingly, or growth in signups becomes a loss.

---

## 5. THE ARCHITECTURE TO BUY

### Step 1 — Move PostgreSQL off the app box. Do this first.

Cheapest and largest single win available. Today the database competes for 3.7 GiB with the
process holding every customer's live socket. **Memory pressure from either one takes down
both, and the database holds the only copy of everything.**

Separating them buys three things at once: the gateway gets the whole machine's RAM, the
database can be backed up and restored independently, and a gateway crash stops being a data
risk. Managed Postgres with automated backups and point-in-time recovery is worth more than
its price the first time something goes wrong.

### Step 2 — Shard the gateway by customer. Do not balance it.

The correct shape is a **routing layer that maps customer → shard**, with each shard a normal
process owning a bounded set of resident sessions:

```
  inbound  ->  router (customer_id -> shard)  ->  shard-1  [sessions 1..N]
                                              ->  shard-2  [sessions N+1..2N]
                                              ->  shard-3  [ ... ]
```

The router is stateless and *can* sit behind a load balancer. **The shards cannot.** Growth
is adding shards and moving customers onto them — not adding interchangeable replicas.

**You already have the hard part.** Session auth state is encrypted **at rest** (Amendment-1,
verified in the file header). That is precisely what lets a customer's session be re-homed to
another shard after a failure. Most projects discover far too late that they cannot move a
session because it only ever existed in RAM. You can.

### Step 3 — "Auto-expand" means: add a shard when residents cross a watermark.

This is real and worth having, but it is **not** an autoscaling group. It is: watch resident
count and RAM headroom per shard; when a shard passes a watermark, start another and route new
pairings to it. Scale-*down* is deliberately manual — evicting a live customer session to save
a few euros is a bad trade.

### Step 4 — The brain: budget and fallback, not servers.

Nothing to buy. What to put in place instead: a spend cap per tenant per period (partly
present — there is a `debit()` path), a **fallback model** so one provider outage does not
take Mira offline, and per-tenant token accounting so a heavy customer is visible before the
invoice arrives.

**Self-hosting a model on your own GPU is not indicated at this stage**, and would be a large
fixed monthly cost replacing a variable one that currently rounds to cents per conversation.
Revisit only when token spend consistently exceeds the cost of the hardware.

---

## 6. WHAT TO BUY NOW — A CONCRETE RECOMMENDATION

For a first hundred customers, in priority order:

1. **A managed PostgreSQL instance** with automated backups and PITR. *Buy this today, before
   anything else, even if you buy nothing else.* It is the difference between a bad day and a
   dead company.
2. **One replacement app VM, RAM-heavy, core-light** — 8 GB RAM / 2–4 vCPU. Not 16 cores.
3. **A second identical app VM**, idle, as the failover target. Two small machines beat one
   large one, because the risk you are carrying is *loss*, not slowness.
4. **Off-site encrypted backups** of the database and the session state directory.

Deliberately **not** on the list: a load balancer, an autoscaling group, GPU inference, and a
Kubernetes cluster. None of them addresses your actual constraint, and each adds a moving part
to a system currently maintained by one person.

---

## 7. WHAT MUST BE MEASURED BEFORE ANY OF THIS IS FINAL

The jury should treat §3 as an **estimate**, and it can be replaced with fact cheaply:

1. **Pair 10 test customers and measure RSS per session.** One afternoon. It converts the
   whole capacity table from inference to measurement and directly sets how many customers a
   shard holds.
2. **Establish what happens when a shard dies.** Does a customer's session resume from
   encrypted state on another process? The design says it should. *Nobody has ever tried it.*
   Until that is tested, the failover machine in §6 is an assumption, not a plan.
3. **Measure token cost per conversation** at the real message rate, to price the tiers.

---

## 8. OPEN ITEM FOR THE OWNER

The instruction included a model or product name transcribed as **"Marcia, the duelist 1.1"**.
The nearest real candidate is **Mistral's Magistral 1.1**, but the LAP rules forbid me acting
on a guessed name, so it is recorded as **UNKNOWN** and nothing has been configured for it.
Confirm the exact name and I will evaluate it as an author or brain model against the current
OpenRouter routing.

Also outstanding and owner-only: rotate `SEARCH_API_KEY`; set `MIRA_BILLING_PUSH_SECRET`
(without it, revocation of a lapsed customer lags by up to one TTL or one sweep).

---

## 9. STATUS OF TODAY'S CODE WORK

| item | state |
|---|---|
| WhatsApp durable memory | **RUNTIME VERIFIED** — ledger 36 → 48 facts, `source='whatsapp'` for the first time |
| Diagnostic logging (`[lap]`, `[voice]`) | **DEPLOYED** — never fired, so unproven by failure |
| Voice pitch/EQ experiment | **REVERTED** to byte-exact original, on owner's order |
| Inbound-voice capability | **DEPLOYED** |
| Four platform-wide capability denials | **DEPLOYED** — files, pulses, away-mode, consent-gated observation |
| Dynamic author-token allocator | **DEPLOYED** in `code_author_mcp` |
