export type BlogBlock =
  | { kind: "p"; text: string }
  | { kind: "h2"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "quote"; text: string };

export type BlogPost = {
  slug: string;
  title: string;
  dek: string;
  date: string;
  readingMinutes: number;
  tags: string[];
  body: BlogBlock[];
};

export const POSTS: BlogPost[] = [
  {
    slug: "a-safety-fix-that-was-not-protecting-anyone",
    title: "A Safety Fix That Was Not Protecting Anyone",
    dek: "Multilingual crisis detection passed every check except the one that matters: whether it was actually running.",
    date: "2026-07-08",
    readingMinutes: 5,
    tags: ["safety", "honesty"],
    body: [
      {
        kind: "p",
        text: "We shipped multilingual crisis detection for Mira Assistant, our WhatsApp assistant. The code recognizes a person disclosing suicidal intent in Arabic, Urdu, Hindi or Persian instead of replying like an ordinary chatbot. It passed its tests, was mutation-checked, and was recorded as closed."
      },
      {
        kind: "h2",
        text: "The production check found a different story"
      },
      {
        kind: "p",
        text: "A later check of the actual production server found zero occurrences of the new code. It had never been deployed. Every commit had honestly said 'not deployed'; the word 'closed' everywhere else described the repository, not the running system."
      },
      {
        kind: "quote",
        text: "A ledger can be accurate row by row and still leave a reader with a false picture."
      },
      {
        kind: "list",
        items: [
          "Repository status: closed",
          "Deployment status: not deployed",
          "Production occurrences: zero"
        ]
      },
      {
        kind: "p",
        text: "The gap was not a failed test. The closure language described the repository while the surrounding process sounded like a production claim. We found the gap by inspecting the host, not because a person triggered the missing path."
      },
      {
        kind: "h2",
        text: "What changed"
      },
      {
        kind: "list",
        items: [
          "Safety-related closures now include live deployment status",
          "A post-deployment host check is required before a safety item can be closed",
          "Previously closed safety items were re-checked for deployment status"
        ]
      },
      {
        kind: "p",
        text: "For anything safety-affecting, production status now belongs in the same sentence as the status word: 'fixed in code, NOT live'. The host must be re-checked before a closure claim is repeated."
      }
    ]
  },
  {
    slug: "the-dashboard-that-invented-its-own-revenue",
    title: "The Dashboard That Invented Its Own Revenue",
    dek: "An internal admin console displayed a hard-coded revenue figure and a chart of numbers we never measured.",
    date: "2026-07-22",
    readingMinutes: 4,
    tags: ["honesty", "engineering"],
    body: [
      {
        kind: "p",
        text: "The internal admin console displayed a hard-coded revenue figure and a fourteen-day chart of numbers that were never measured. It was scaffolding that outlived its purpose."
      },
      {
        kind: "h2",
        text: "How it survived"
      },
      {
        kind: "p",
        text: "The revenue widget had been put in place while the first screens were being built. It survived because it looked enough like reporting, and enough people passed it every day that nobody questioned the values."
      },
      {
        kind: "list",
        items: [
          "Revenue figure: hard-coded",
          "Fourteen-day chart: generated from a static array",
          "Measurement source: none"
        ]
      },
      {
        kind: "quote",
        text: "A fabricated zero reads as 'no revenue' when the truth is 'not measured here'."
      },
      {
        kind: "h2",
        text: "The fix"
      },
      {
        kind: "p",
        text: "We did not try to compute the numbers. The app genuinely cannot know them: prices live at the payment provider, and usage is metered elsewhere. Instead we deleted the fiction and declared each unmeasurable metric with the reason it cannot be known."
      },
      {
        kind: "list",
        items: [
          "Removed the hard-coded revenue widget",
          "Removed chart columns the data layer does not hold",
          "Added an explicit not-measured state instead of dash placeholders",
          "Added a regression test that fails the build if the old figures reappear"
        ]
      },
      {
        kind: "p",
        text: "The dashboard now has fewer numbers and more honest rows. That is the intended state."
      }
    ]
  },
  {
    slug: "a-payment-for-another-product-nearly-opened-ours",
    title: "A Payment for Another Product Nearly Opened Ours",
    dek: "A valid signature proves who sent an event, not which product it belongs to.",
    date: "2026-08-05",
    readingMinutes: 5,
    tags: ["billing", "security"],
    body: [
      {
        kind: "p",
        text: "When we added a second product to the same payment merchant account, we assumed the provider's event fan-out would keep products separate. It does not. The provider fans every event out to every configured endpoint, signing each with that endpoint's own secret."
      },
      {
        kind: "h2",
        text: "Why the signature was not enough"
      },
      {
        kind: "p",
        text: "The other product's payment events arrived at this application with valid signatures. The old code resolved an unknown product by granting the cheapest paid tier rather than refusing a paying customer. That rule was written when only one product existed, and its premise had quietly become false."
      },
      {
        kind: "quote",
        text: "A valid signature proves the sender is the provider; it does not prove the event is yours."
      },
      {
        kind: "list",
        items: [
          "Signed event: valid",
          "Product in the event: unknown",
          "Old behavior: grant cheapest paid tier",
          "Actual effect: activate service from another product"
        ]
      },
      {
        kind: "h2",
        text: "The new guard"
      },
      {
        kind: "p",
        text: "The guard now requires positive proof. A tier is granted only when the product id matches the allowlist. Anything else is recorded and granted nothing."
      },
      {
        kind: "list",
        items: [
          "Product id must match the allowlist",
          "Unknown events are logged",
          "Unknown events grant nothing",
          "Unknown events are refused rather than resolved to a fallback tier"
        ]
      },
      {
        kind: "p",
        text: "The guard is mutation-tested. Disabling it fails exactly the two tests that model the attack."
      }
    ]
  },
  {
    slug: "the-scheduled-job-that-ran-perfectly-and-did-nothing",
    title: "The Scheduled Job That Ran Perfectly and Did Nothing",
    dek: "A timer unit that parses, installs and schedules correctly can still be completely inert.",
    date: "2026-08-14",
    readingMinutes: 5,
    tags: ["operations", "engineering"],
    body: [
      {
        kind: "p",
        text: "A repair sweep was scheduled with a systemd timer. The unit parsed, installed and scheduled correctly. It was also completely inert: it pointed at an environment file that did not exist, and because the path carried a dash prefix - which means 'run anyway if the file is missing' - it started with no credentials, correctly refused to act, and failed quietly on a schedule."
      },
      {
        kind: "h2",
        text: "First defect"
      },
      {
        kind: "p",
        text: "The missing environment file did not prevent startup. The dash prefix made the missing file acceptable, so the job ran without credentials and then refused to act."
      },
      {
        kind: "list",
        items: [
          "Timer unit: parsed, installed, scheduled",
          "Environment file: missing",
          "Process start: succeeded without credentials",
          "Work performed: none"
        ]
      },
      {
        kind: "p",
        text: "Once the path was fixed, it reported FAILED on every successful run, because the script exits 2 to mean 'found things a human should look at' and systemd treats any non-zero as failure. An operator who sees red every hour stops reading red."
      },
      {
        kind: "quote",
        text: "A unit file is configuration against a machine you have not inspected; 'it parses' proves nothing."
      },
      {
        kind: "h2",
        text: "What changed"
      },
      {
        kind: "list",
        items: [
          "Corrected the environment file path",
          "Mapped exit code 2 to success with a human-readable notice",
          "Added a smoke execution before enabling a timer",
          "Alert only on real failures"
        ]
      },
      {
        kind: "p",
        text: "Both defects were invisible until the unit was actually executed. A unit file is configuration against a machine you have not inspected; parsing it only proves that it parsed."
      }
    ]
  },
  {
    slug: "why-filehub-has-no-thumbnails",
    title: "Why FileHub Has No Thumbnails",
    dek: "End-to-end encryption removes features people expect, and that is the point.",
    date: "2026-08-26",
    readingMinutes: 4,
    tags: ["encryption", "security"],
    body: [
      {
        kind: "p",
        text: "FileHub is end-to-end encrypted: verified in a real browser, the server cannot read new uploads. That single property removes features people expect. Server-side preview and thumbnail generation were deliberately removed, because generating a preview requires the server to read the file."
      },
      {
        kind: "h2",
        text: "What encryption removes"
      },
      {
        kind: "list",
        items: [
          "Server-side preview: removed",
          "Thumbnail generation: removed",
          "Folder structure: stored in encrypted metadata",
          "Folder names: not written to disk"
        ]
      },
      {
        kind: "p",
        text: "Folder uploads keep their structure sealed inside encrypted metadata rather than written to disk, so the company does not learn folder names either. The vault passphrase is deliberately separate from the account password."
      },
      {
        kind: "quote",
        text: "A product that cannot read user files also cannot build previews of them."
      },
      {
        kind: "h2",
        text: "Where FileHub stands"
      },
      {
        kind: "p",
        text: "An upload into a vault with no recovery key is refused rather than stored unrecoverably. The honest limit is that FileHub is not yet certified for commercial sale: encryption, authentication and isolation are verified, but other parts are unfinished."
      },
      {
        kind: "list",
        items: [
          "Encryption: verified in a real browser",
          "Server access to new uploads: none",
          "Vault passphrase: separate from account password",
          "Commercial sale certification: not yet complete"
        ]
      }
    ]
  },
{
    slug: "we-attacked-our-own-multi-tenancy",
    title: "We Attacked Our Own Multi-Tenancy",
    dek: "Unit tests protected tenant isolation, but the isolation had never been attacked on purpose.",
    date: "2026-06-02",
    readingMinutes: 4,
    tags: ["multi-tenancy", "security"],
    body: [
      {
        kind: "p",
        text: "The tenant isolation code had unit tests, but it had never been attacked. Each guard had to prove it could repel a deliberate assault."
      },
      {
        kind: "h2",
        text: "Designing the assault suite"
      },
      {
        kind: "p",
        text: "Each test tries one path that should be repelled."
      },
      {
        kind: "list",
        items: [
          "A payment event carrying another product's identifier but a colliding email must not mint an account.",
          "One customer's event must not rewrite another tenant's record.",
          "An email lookup must never hand back a neighbour.",
          "An unknown email must return nothing rather than the nearest match.",
          "A tampered signature must be refused and change nothing."
        ]
      },
      {
        kind: "h2",
        text: "Mutation checks"
      },
      {
        kind: "p",
        text: "After each test passed, the guard was deliberately switched off to confirm the test actually failed."
      },
      {
        kind: "p",
        text: "A test that passes when the protection is removed was never testing the protection."
      }
    ]
  },
  {
    slug: "what-reality-actually-hides",
    title: "What Reality Actually Hides",
    dek: "Mira VPN's transport is deliberately simple, and this is what that simplicity does and does not do.",
    date: "2026-07-14",
    readingMinutes: 6,
    tags: ["security", "engineering"],
    body: [
      {
        kind: "p",
        text: "Mira VPN uses the VLESS plus REALITY transport. The connection is presented as ordinary TLS traffic to a well-known CDN host, so a network observer sees a routine HTTPS session rather than a recognisable VPN handshake."
      },
      {
        kind: "h2",
        text: "What is deliberately simple"
      },
      {
        kind: "p",
        text: "The service runs plain REALITY without the xtls-rprx-vision flow. That simplification leaves fewer moving parts in the path that matters."
      },
      {
        kind: "h2",
        text: "What it does and does not do"
      },
      {
        kind: "p",
        text: "This addresses traffic that is identifiable as a VPN. It is not a claim about breaking cryptography, and it is not anonymity from an endpoint that already knows who you are."
      },
      {
        kind: "quote",
        text: "Independently owned and funded by Vualet. No state backing and no sponsor answering to a state."
      },
      {
        kind: "p",
        text: "Twenty press accounts have been provisioned and run on the transport."
      }
    ]
  },
  {
    slug: "ascii-word-boundaries-do-not-work-in-arabic",
    title: "ASCII Word Boundaries Do Not Work in Arabic",
    dek: "A crisis detector looked correct but silently missed writing outside Latin script.",
    date: "2026-07-28",
    readingMinutes: 5,
    tags: ["safety", "engineering"],
    body: [
      {
        kind: "p",
        text: "A crisis detector written with the regular-expression word boundary looked correct and silently matched nothing outside Latin script, because that boundary is an ASCII concept."
      },
      {
        kind: "h2",
        text: "What the first repair missed"
      },
      {
        kind: "p",
        text: "The first attempt replaced the boundary with full-sentence literal phrases. It still missed real people, because real writing varies."
      },
      {
        kind: "list",
        items: [
          "Hindi written with chandrabindu versus anusvara.",
          "Persian verb forms spaced, joined, or separated by a zero-width non-joiner.",
          "Urdu masculine and feminine endings."
        ]
      },
      {
        kind: "h2",
        text: "What we do now"
      },
      {
        kind: "p",
        text: "The working approach matches core phrase fragments with no word boundaries at all."
      },
      {
        kind: "p",
        text: "The test suite now pins every one of those variants so the earlier mistake cannot return."
      },
      {
        kind: "p",
        text: "A false positive costs one unnecessary supportive message. A false negative means a person in crisis receives an ordinary chatbot reply."
      }
    ]
  },
  {
    slug: "never-invent-an-emergency-number",
    title: "Never Invent an Emergency Number",
    dek: "Widening crisis detection and translating emergency guidance are separate jobs, and a test keeps them that way.",
    date: "2026-08-11",
    readingMinutes: 4,
    tags: ["safety", "honesty"],
    body: [
      {
        kind: "p",
        text: "When the crisis detector was made multilingual, the hotline text and the reply were left byte-identical and verified as unchanged."
      },
      {
        kind: "h2",
        text: "Two jobs, kept apart"
      },
      {
        kind: "p",
        text: "Widening detection and translating emergency guidance are deliberately separate jobs."
      },
      {
        kind: "p",
        text: "Regional hotline numbers are owner work, not something a code generator may produce. A wrong emergency number handed to someone in crisis could cost a life."
      },
      {
        kind: "h2",
        text: "A known limit"
      },
      {
        kind: "p",
        text: "The reply is still English even when detection fires in another language. We state that openly, on the grounds that a detected crisis with an English reply is better than an undetected one."
      },
      {
        kind: "p",
        text: "A regression test covers the reply."
      },
      {
        kind: "list",
        items: [
          "It asserts the real hotline numbers are present.",
          "It asserts that no other number has crept in."
        ]
      }
    ]
  },
  {
    slug: "what-we-say-when-we-cannot-measure-something",
    title: "What We Say When We Cannot Measure Something",
    dek: "A metric that cannot be truthfully sourced is declared unavailable, not rendered as a number.",
    date: "2026-08-25",
    readingMinutes: 3,
    tags: ["honesty", "engineering"],
    body: [
      {
        kind: "p",
        text: "Some numbers a system genuinely cannot know. The temptation is to render zero, or to compute something plausible. Both lie."
      },
      {
        kind: "h2",
        text: "The rule"
      },
      {
        kind: "p",
        text: "A metric that cannot be truthfully sourced is declared unavailable, with the reason, and never rendered as a number."
      },
      {
        kind: "h2",
        text: "What that looked like"
      },
      {
        kind: "list",
        items: [
          "An admin console that shows a dash and an explanation where revenue used to be invented.",
          "Columns removed rather than filled with placeholder dashes.",
          "A page that says no health instrumentation is wired yet rather than showing invented uptime."
        ]
      },
      {
        kind: "p",
        text: "The same rule sits under the customer-facing claim policy."
      },
      {
        kind: "p",
        text: "It is why the security pages carry no superlatives and why an unfinished product is labelled unfinished."
      }
    ]
  },
{
  slug: "the-object-returned-where-a-string-was-expected",
  title: "The Object Returned Where a String Was Expected",
  dek: "A WhatsApp normaliser returned an object instead of a string. Nothing threw. The bug was silent data corruption.",
  date: "2026-06-03",
  readingMinutes: 4,
  tags: ["engineering", "honesty"],
  body: [
    {
      kind: "p",
      text: "We changed a function that normalises WhatsApp addresses. It used to return a plain string. We made it return an object with fields for the local part, domain, and a pre-combined display form."
    },
    {
      kind: "h2",
      text: "What broke"
    },
    {
      kind: "p",
      text: "Several call sites still used the return value as if it were a string. Nothing threw. The object was interpolated into a template literal and became the literal text [object Object]. That string was then stored as an identifier."
    },
    {
      kind: "p",
      text: "The lookup that used the identifier never matched an existing record. The code silently created a new record every time instead of finding the one that was already there."
    },
    {
      kind: "h2",
      text: "Why it was silent"
    },
    {
      kind: "p",
      text: "In a dynamically typed path, changing a return type does not break loudly. It breaks quietly and downstream, as bad data. No exception was raised. No log line looked unusual. The only symptom was a growing number of duplicate records."
    },
    {
      kind: "h2",
      text: "What we fixed"
    },
    {
      kind: "list",
      items: [
        "Updated every call site to destructure the object and use the correct field.",
        "Added tests that assert on the shape of the returned value, not only on whether the call succeeded.",
        "Added a lint rule that flags implicit string conversion of objects in template literals."
      ]
    }
  ]
},
{
  slug: "a-migration-runner-that-runs-every-time",
  title: "A Migration Runner That Runs Every Time",
  dek: "Our database migrations were idempotent and ran on startup. The problem was which process actually started.",
  date: "2026-06-08",
  readingMinutes: 5,
  tags: ["engineering", "operations"],
  body: [
    {
      kind: "p",
      text: "Our database schema function re-runs every migration on every process startup, by design. The migrations are written to be idempotent, so this is safe. It is also convenient: you never need to remember to run a migration manually."
    },
    {
      kind: "h2",
      text: "The hidden assumption"
    },
    {
      kind: "p",
      text: "Two processes share the database: the bot process and the gateway process. Only one of them calls the migration runner. The bot calls it. The gateway does not."
    },
    {
      kind: "p",
      text: "A migration added for the gateway's benefit only reached the database when the bot happened to restart. Deploying the gateway alone applied nothing. The team had assumed schema was a property of the deployment. It was actually a property of which process restarted."
    },
    {
      kind: "h2",
      text: "The operational gap"
    },
    {
      kind: "quote",
      text: "We merged the migration. We deployed the gateway. We checked the deploy succeeded. The column was not there."
    },
    {
      kind: "h2",
      text: "The new rule"
    },
    {
      kind: "list",
      items: [
        "After a schema change, verify the column exists on the live database. Do not infer it from a successful deploy.",
        "Document which process owns schema application for each database.",
        "Consider running migrations from a separate init container rather than coupling them to application startup."
      ]
    }
  ]
},
{
  slug: "escaping-is-where-correct-code-goes-to-die",
  title: "Escaping Is Where Correct Code Goes to Die",
  dek: "A shell heredoc ate one level of backslash escaping. JavaScript ate another. The regex matched nothing.",
  date: "2026-06-14",
  readingMinutes: 5,
  tags: ["engineering", "honesty"],
  body: [
    {
      kind: "p",
      text: "We wrote regular expressions into files using a shell heredoc. The heredoc consumed one level of backslash escaping. What reached disk had a single backslash where we intended two. JavaScript then consumed its own level. The pattern that was meant to match a word with optional trailing characters instead matched a literal repeated letter."
    },
    {
      kind: "h2",
      text: "Why nothing caught it"
    },
    {
      kind: "p",
      text: "The syntax checker passed. The file was valid JavaScript. It simply meant something different from what we thought it meant. The regex compiled without error and matched nothing. No test exercised the function against sample input, so no test failed."
    },
    {
      kind: "h2",
      text: "It happened more than once"
    },
    {
      kind: "p",
      text: "This was not a one-off mistake. The same class of bug recurred until we understood the root cause. Each time, the symptom was a feature that silently stopped working. Each time, the code looked correct on review."
    },
    {
      kind: "h2",
      text: "What we changed"
    },
    {
      kind: "list",
      items: [
        "Build characters from their code points instead of typing a backslash into a heredoc.",
        "Prefer a real file-writing tool over shell redirection when generating code.",
        "Execute the function against sample input and assert on the match. Valid syntax is not evidence of correct behaviour."
      ]
    },
    {
      kind: "quote",
      text: "The only reliable check is to run it. A regex that compiles is not a regex that works."
    }
  ]
},
{
  slug: "we-let-the-model-write-it-and-then-checked-every-line",
  title: "We Let the Model Write It and Then Checked Every Line",
  dek: "A plain account of what our code authoring pipeline got right, what it fabricated, and why human review against real code still matters.",
  date: "2026-06-19",
  readingMinutes: 5,
  tags: ["engineering", "honesty"],
  body: [
    {
      kind: "p",
      text: "We use a language model pipeline to author code at Vualet."
    },
    {
      kind: "p",
      text: "A dossier describing the change goes in. A model writes it. A second model judges it. Revisions loop until approval."
    },
    {
      kind: "h2",
      text: "What it invented"
    },
    {
      kind: "p",
      text: "The pipeline works well enough that we kept it. It also invented things."
    },
    {
      kind: "list",
      items: [
        "A security contact email address that does not exist at this company.",
        "A CSS variable that is not defined in the codebase.",
        "Names for payment event types that do not follow the real naming convention.",
        "An omitted await on an asynchronous call."
      ]
    },
    {
      kind: "p",
      text: "Each of those was caught by a human reading the output against the actual codebase."
    },
    {
      kind: "h2",
      text: "What we concluded"
    },
    {
      kind: "p",
      text: "The conclusion is not that generated code is unusable. It is that a model given an incomplete description of a system will fill the gaps confidently, and that review must be against the real code, not against the description that was fed in."
    },
    {
      kind: "p",
      text: "Where the dossier elided detail with a placeholder, the model invented what belonged there."
    }
  ]
},
{
  slug: "what-independent-ownership-means-here",
  title: "What Independent Ownership Means Here",
  dek: "A note on what Vualet's ownership declaration is, what it is not, and which parts of our stack a reader can check independently.",
  date: "2026-06-25",
  readingMinutes: 5,
  tags: ["security", "honesty"],
  body: [
    {
      kind: "p",
      text: "Vualet states that it is independently owned and funded, with no state backing and no sponsor answering to a state."
    },
    {
      kind: "p",
      text: "This post is about what that claim is and is not. It is the company's own declaration. It is not an audit finding. Nobody outside the company has verified it."
    },
    {
      kind: "h2",
      text: "Why we state it"
    },
    {
      kind: "p",
      text: "For some users the ownership of a VPN provider is part of the threat model. A company that will not answer the question is itself an answer."
    },
    {
      kind: "h2",
      text: "What can be checked independently"
    },
    {
      kind: "p",
      text: "Architecture can be checked: the transport protocol in use, whether the traffic pattern is distinguishable from ordinary web traffic, and whether the file storage can read what it stores."
    },
    {
      kind: "quote",
      text: "A declaration is not a verified finding. A verified finding is produced by independent inspection."
    },
    {
      kind: "p",
      text: "Structural independence is offered as a statement of fact by the people who would know. Readers should treat it accordingly, neither dismissed nor mistaken for third-party verification."
    }
  ]
},
{
  slug: "a-test-you-can-delete-the-code-and-still-pass",
  title: "A Test You Can Delete the Code and Still Pass",
  dek: "Mutation checking shows whether a test constrains behavior.",
  date: "2026-05-04",
  readingMinutes: 4,
  tags: ["engineering", "security"],
  body: [
    {
      kind: "p",
      text: "A test suite that stays green when you delete the thing it tests is not a test suite. It is decoration."
    },
    {
      kind: "p",
      text: "We use mutation checking for security guards. We write a test for the guard, then deliberately break the guard and watch which tests fail."
    },
    {
      kind: "h2",
      text: "Evidence by deletion"
    },
    {
      kind: "list",
      items: [
        "Disable the isolation guard.",
        "Confirm exactly the two attack-modeling tests fail.",
        "Restore the guard and run the suite again."
      ]
    },
    {
      kind: "p",
      text: "In one recent guard, disabling it failed precisely the two tests that model the attack. That failure is the evidence that the tests are load-bearing."
    },
    {
      kind: "h2",
      text: "Do not weaken a failing assertion"
    },
    {
      kind: "p",
      text: "When a test fails, either the code is wrong or the test encodes a requirement you decided to change. Decide that change deliberately and in writing."
    },
    {
      kind: "p",
      text: "Editing an assertion until it goes green is how a suite stops meaning anything."
    }
  ]
},
{
  slug: "the-passphrase-is-not-the-password",
  title: "The Passphrase Is Not the Password",
  dek: "FileHub splits login authentication from the key that decrypts files.",
  date: "2026-05-06",
  readingMinutes: 5,
  tags: ["security", "encryption"],
  body: [
    {
      kind: "p",
      text: "FileHub uses two secrets. The account password authenticates you to the service. The vault passphrase derives the key that decrypts your files."
    },
    {
      kind: "p",
      text: "They are different secrets for a reason."
    },
    {
      kind: "h2",
      text: "Why the split matters"
    },
    {
      kind: "p",
      text: "If the account password and vault passphrase were the same, the service that verifies login would be in a position to derive the file key. We do not want that position."
    },
    {
      kind: "h2",
      text: "Loss without a recovery key"
    },
    {
      kind: "p",
      text: "If you lose the vault passphrase and have no recovery key, the company cannot help you. That is the property working as designed, not a support failure."
    },
    {
      kind: "list",
      items: [
        "Keep account login separate from the vault passphrase.",
        "Refuse uploads into vaults that have no recovery key rather than accept unrecoverable storage."
      ]
    },
    {
      kind: "h2",
      text: "Certification status"
    },
    {
      kind: "p",
      text: "FileHub is not yet certified for commercial sale. Its encryption, authentication, and isolation are verified. Other parts are unfinished."
    }
  ]
},
{
  slug: "reading-a-status-word-is-not-reading-a-system",
  title: "Reading a Status Word Is Not Reading a System",
  dek: "The vocabulary of done now carries deployment state.",
  date: "2026-05-08",
  readingMinutes: 5,
  tags: ["engineering", "operations", "safety"],
  body: [
    {
      kind: "p",
      text: "The company keeps a hash-chained engineering ledger. Every row is evidence."
    },
    {
      kind: "p",
      text: "Rows can be individually accurate and still leave a reader with a false picture. A word like 'closed' described the repository while the surrounding process sounded like a claim about production."
    },
    {
      kind: "h2",
      text: "The vocabulary of done"
    },
    {
      kind: "p",
      text: "Nothing was falsified. The vocabulary was ambiguous. For anything safety-affecting, the status word must carry its deployment state in the same sentence."
    },
    {
      kind: "quote",
      text: "'Fixed in code, not live' is a complete status. 'Closed' is not."
    },
    {
      kind: "h2",
      text: "Write only after proof"
    },
    {
      kind: "p",
      text: "A status is answered from the ledger, but a status is only written after real proof."
    },
    {
      kind: "p",
      text: "Verify once, record it, then trust the record."
    }
  ]
},
{
  slug: "when-a-number-cannot-be-known-say-so",
  title: "When a Number Cannot Be Known, Say So",
  dek: "Unavailable data needs a distinct state, not a plausible placeholder.",
  date: "2026-05-10",
  readingMinutes: 4,
  tags: ["engineering", "honesty", "billing"],
  body: [
    {
      kind: "p",
      text: "An internal console was showing figures the application had no way to compute. Pricing lives at the payment provider. Some usage is metered in a different system."
    },
    {
      kind: "p",
      text: "The instinct is to show a zero or a dash. Both are read as measurements."
    },
    {
      kind: "h2",
      text: "Zero and dash are claims"
    },
    {
      kind: "p",
      text: "A zero says 'none'. A dash says 'loading'. Neither says 'this application cannot know this'."
    },
    {
      kind: "list",
      items: [
        "Show an explicit unavailable state when the value cannot be sourced.",
        "Name the reason the value is unavailable.",
        "Apply this to any metric the system cannot source."
      ]
    },
    {
      kind: "h2",
      text: "Public site"
    },
    {
      kind: "p",
      text: "The same rule applies to the public site. Where a security property cannot be measured, the site says so rather than reaching for an adjective."
    }
  ]
},
{
  slug: "the-safest-thing-we-could-say",
  title: "The Safest Thing We Could Say",
  dek: "Public security pages carry verified architecture, not adjectives.",
  date: "2026-05-12",
  readingMinutes: 4,
  tags: ["security", "honesty", "safety"],
  body: [
    {
      kind: "p",
      text: "People who need secure tools are harmed by a claim that does not hold. Someone in real danger who chooses a tool because of an unverifiable superlative is harmed by the claim."
    },
    {
      kind: "p",
      text: "The public security page carries verified architecture instead of adjectives."
    },
    {
      kind: "h2",
      text: "What the page says"
    },
    {
      kind: "list",
      items: [
        "The VPN uses a transport that presents as ordinary TLS to a well-known host.",
        "File storage is end-to-end encrypted and verified in a real browser, so the server cannot read new uploads.",
        "There are no server-side previews because generating one would require reading the file.",
        "Cross-tenant isolation was tested adversarially."
      ]
    },
    {
      kind: "h2",
      text: "What the page declines to say"
    },
    {
      kind: "p",
      text: "It does not say anything is unbreakable. It does not call the company's own audit independent."
    },
    {
      kind: "p",
      text: "An independent third-party security audit or a published penetration test report would license stronger language. Until one exists, the page says the company does not run its own audit and call it independent."
    },
    {
      kind: "h2",
      text: "Honesty and persuasion"
    },
    {
      kind: "p",
      text: "Specific verified architecture is more persuasive to a technically literate reader than any adjective. The honest path and the effective path turned out to be the same path."
    }
  ]
}
];

export function allPosts(): BlogPost[] {
  return [...POSTS].sort((a, b) => b.date.localeCompare(a.date));
}

export function getPost(slug: string): BlogPost | undefined {
  return POSTS.find((post) => post.slug === slug);
}

export function allTags(): string[] {
  const tags = new Set<string>();

  for (const post of POSTS) {
    for (const tag of post.tags) {
      tags.add(tag);
    }
  }

  return Array.from(tags).sort((a, b) => a.localeCompare(b));
}
