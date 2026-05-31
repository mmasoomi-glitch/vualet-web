# Vualet — What only YOU can do

Everything in this list requires a human + a browser tab. The rest, the agents handle.

Open these tabs in order. Each step is ~5 minutes.

## 1. Cloudflare account (5 min)

1. Open https://dash.cloudflare.com/sign-up
2. Sign up with `afaqsubs@gmail.com` (or your preferred Vualet ops email).
3. Once in, click **Add a site** → enter `vualet.com` → pick the **Free** plan.
4. Cloudflare will scan existing DNS records and show you two assigned nameservers, e.g. `xxx.ns.cloudflare.com` and `yyy.ns.cloudflare.com`.
5. **Copy those two nameservers.** Tell Claude the values OR paste them into `C:\Users\HI\Desktop\Vualet\.secrets\cloudflare-ns.txt`.

## 2. Bluehost — switch nameservers (5 min)

1. Log into https://my.bluehost.com.
2. Find vualet.com. Domains → Manage → DNS → Nameservers.
3. Replace `ns1.bluehost.com` / `ns2.bluehost.com` with the two Cloudflare nameservers from step 1.
4. Save. Propagation: 5 minutes to a few hours.
5. **Important — do not touch anything else in Bluehost.** WordPress keeps running on `66.235.200.145`; we cut DNS over to Hetzner *after* the new site is live.

## 3. Paddle merchant-of-record account (15 min)

1. Open https://paddle.com → Sign up.
2. Use these company details when asked:
   - Legal name: **Afaq Alnaseem Trading LLC**
   - Country: **United Arab Emirates**
   - TRN: **100475523500003**
   - Address: your Dubai trade-licence address
3. Upload trade licence + Emirates ID when prompted (Paddle's KYC takes ~24-72 h).
4. Skip product creation for now. Just complete the account-onboarding form and submit for review.
5. Tell Claude when the account is approved. The approval email will say "You can now create live products."

## 4. Clerk account (3 min)

1. Open https://clerk.com → Sign up.
2. Create an application called **Vualet**.
3. Add `vualet.com` as the allowed domain.
4. Copy `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` from the dashboard.
5. Paste them into `C:\Users\HI\Desktop\Vualet\.secrets\clerk.txt`.

## 5. Supabase project (5 min)

1. Open https://supabase.com → Sign up / sign in.
2. Create a new project named **vualet-prod**, region **eu-central-1** (Frankfurt — closest to your Hetzner Helsinki).
3. Wait ~2 min for provisioning.
4. Project Settings → API → copy:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY`
5. Paste into `C:\Users\HI\Desktop\Vualet\.secrets\supabase.txt`.

## 6. Resend (transactional email) (3 min)

1. Open https://resend.com → Sign up.
2. Add `vualet.com` as a sending domain (Resend will give you 3 DNS records — Claude will add them in Cloudflare).
3. Create an API key called **vualet-prod**. Paste into `.secrets\resend.txt`.

## 7. Loops (lifecycle email) — *can wait until after launch* (3 min)

Same flow as Resend. Paste key into `.secrets\loops.txt`.

## 8. PostHog (product analytics) (3 min)

1. Open https://posthog.com → Sign up. Pick **EU Cloud** region.
2. Create a project **Vualet**. Copy the project API key.
3. Paste into `.secrets\posthog.txt`.

## 9. Plausible (marketing analytics) — optional (2 min)

1. Open https://plausible.io → 30-day free trial. Or self-host later.
2. Add `vualet.com` site. Copy the embed snippet (it goes in the marketing site head).

## 10. Hetzner — give Claude SSH access (2 min)

The deploy pipeline pushes Docker images and SSHes into the box. Claude needs a deploy key.

1. On the Hetzner Cloud Console → Project → Security → **SSH Keys**, confirm your existing SSH key is registered to `afaq-commerce-01`. (You already SSH into the box, so it is.)
2. Tell Claude: "use my existing SSH key at `C:\Users\HI\.ssh\id_ed25519`" — or generate a dedicated deploy key.
3. Claude will add the matching public key to GitHub Actions as `DEPLOY_SSH_KEY`.

## 11. Claude Code Cloud workspace (5 min)

This is where the marketing-site work continues while local Claude handles infra.

1. Open https://claude.ai/code in a fresh browser tab.
2. Sign in with the same account that owns this local Claude Code.
3. Click **Create workspace** → connect GitHub → grant access to `mmasoomi-glitch/vualet-web`.
4. Once the workspace boots, paste this as the first prompt:

   ```
   Read docs/CLOUD_AGENT_BRIEF.md and follow it. Start with chunk 1.
   ```

5. The cloud Claude takes over. Local Claude (me) handles the Hetzner + DNS + secrets work in parallel.

---

## Done-checks

After all eleven steps, tell local Claude **"all done"** and Claude will:

1. Verify Cloudflare nameservers have propagated.
2. Read all the `.secrets/*.txt` files.
3. Add every secret to GitHub Actions as a repository secret.
4. SSH into Hetzner, create `/opt/vualet-web`, and run the first deploy.
5. Add DNS records in Cloudflare pointing `vualet.com` and `www.vualet.com` to `89.167.49.209`.
6. Verify the new site loads on HTTPS.
7. Tell you when it's safe to cancel the Bluehost hosting plan.
