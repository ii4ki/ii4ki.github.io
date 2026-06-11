---
title: When Three AIs Disagree About Your Code
description: "I had one model write a security plan, a second review it, and a third red-team it. Both reviewers were frontier models. Both were wrong in different ways."
pubDate: 2026-06-11
tags: [ai, security, workflow]
draft: false
---

I had a security hole to close in an app that takes real money, and I didn't trust myself to plan the fix alone.

The hole was the boring, dangerous kind: the server trusted an identity string the client sent it. Hand it someone else's id and it would happily hand back their data. The fix wasn't hard to describe — mint a signed token at login, verify it, bind it to the id every route touches — but the app was a brownfield tangle, the change touched the payment path, and one wrong move would either leave the hole open or lock every paying user out. The sort of change where the plan matters more than the code.

So I did what's becoming a reflex: I had one model write the plan, a second model review it, and a third red-team the result over several rounds. Three models, three jobs. It felt thorough.

It *was* thorough. But not in the way I expected, and the interesting part is where each model broke. The plan came from Opus, the reviewing pass was the freshly released Fable 5 (I specifically wanted to throw it at something tangled and high-stakes, not a toy), and the red-team rounds were GPT 5.5 on its highest reasoning setting. Two frontier models on review duty. **Both of them failed, in opposite directions.** This post is about those failures, because they taught me more about reviewing-with-AI than any success would have.

## The setup: why three models instead of one

A model reviewing its own plan is a bad idea for the same reason you don't proofread your own writing at 2am. It shares the blind spots that produced the work. Different model families fail differently — they were trained on different data, tuned by different teams, and they hallucinate and overlook in uncorrelated ways. Point a second family at the first one's output and the things one is blind to, the other often sees clearly.

That's the whole theory. In practice it works — but it produces a new problem nobody warns you about: **the reviewers disagree, and they disagree confidently.** Now you have three documents and no referee.

## The rule that made it work

The thing that saved this from becoming three robots arguing in a parking lot was a single rule I gave the reviewing model:

> Trust neither the plan nor the other reviewer. Verify every disputed claim at the source before taking a side. Classify each finding as one of: **(a) real and new** — the code actually contradicts the plan; **(b) already addressed** — the plan already covers it, cite where; **(c) wrong** — the reviewer misread the code, show the evidence.

That's the entire discipline. It's the difference between "the AI said there's a bug" and "there is a bug, here is the line." Without it, you're just laundering one model's opinion through another. With it, every claim has to survive contact with the actual file.

The payoff looked like this — a real triage table from one of the rounds, abstracted:

| Finding from the red-team | Verdict | What the code actually showed |
|---|---|---|
| A route still trusts a client-supplied id | (a) real and new | Confirmed at the source — folded into the plan |
| The fix would silently break refunds for users without a token | (a) real and new | Confirmed — the dangerous one, see below |
| "This public endpoint will get accidentally locked" | (b) already addressed | The plan already kept it public, with a self-check |
| "This step contradicts the stop conditions" | (b) already addressed | The contradiction dissolved on reading the next section |
| "This whole step is a no-go" | (c) miscalibrated | The cited bug was real but out of scope — see below |

Five findings, three different verdicts. If I'd taken the red-team's output at face value, I'd have rewritten things that were already fine and rejected a step that didn't deserve it.

## The catch that mattered

Here's the finding that justified the entire exercise.

The plan proposed switching a hot, frequently-polled endpoint over to the new authenticated identity. Clean, obvious, correct-looking. The red-team flagged it: at this stage of the rollout, most real users *don't have a token yet* — it only lands at their next login. Switch that endpoint to the authenticated identity now and, for every tokenless user, the identity goes blank. And that endpoint is the one that issues **refunds when a generation fails.**

Read that twice, because it's the kind of bug you don't find in a code review of the diff — you find it by reasoning about *who is holding a token at the moment the code runs.* The app has an ironclad rule: never charge for a failed generation. This change would have quietly broken that rule for exactly the users who hadn't logged in again yet. Invisible in testing. Visible only as real customers, weeks later, not getting their money back.

One model's plan would have shipped it. Another model's red-team caught it. Neither, alone, was enough. That's cross-model review earning its keep — not "the AI found a bug," but two AIs with different blind spots, one covering for the other.

## The verdict that was wrong

And then the same red-team taught me the opposite lesson.

In an earlier round it had **approved** a particular step — a small, self-contained piece of path-safety work. A round later, looking at the same step, it **rejected** it: a flat no-go. Same plan, same code, opposite verdict.

So I did what the rule says: I went to the source. The new objection cited a real bug — there genuinely was a second way to traverse the filesystem that the step didn't close. But it was a *different class* of bug, in a different part of the code, out of the step's stated scope. Real finding, wrong verdict. The step was still a "go"; the bug was a separate backlog ticket.

The lesson stuck harder than the catch did: **treat the go/no-go label as noise, and weight the evidence underneath it.** A confident "no-go" from a frontier model is not a decision. It's a pointer to some evidence you should go read yourself. Half the time the evidence is real and the verdict it's attached to is wrong.

## Knowing when to stop

The part nobody talks about: when do you stop reviewing?

The current AI-hype reflex is "always add another pass." More review, more models, more rounds — it sounds responsible. But I had the data to see it wasn't. Here's the signal-per-round, counted honestly:

| Review round | Real, load-bearing findings | Cosmetic / already-covered |
|---|---|---|
| Earlier pass | 2 (one protected the money path) | a few |
| Next round | 2 (folded the above) | — |
| Latest round | **1** | 3 |

The curve is right there. The findings that mattered came early. By the latest round I was folding a renamed helper and a timestamp suffix — polish, not protection — around a single genuine catch. Each additional round was costing more attention than it returned. **Negative expected value, dressed up as diligence.**

And the deciding insight: the questions I had left weren't *reviewable* anymore. Whether the fix matches reality, whether the rollout is clean — those don't get answered by a seventh read of the document. They get answered by *running it* and reading the logs. At some point the plan is as good as a plan can get, and staring at it harder is just procrastination with extra steps. The remaining truth lives in production, not in the doc.

## The Gist

Three models, and the useful lessons all came from where they failed:

- **A model reviewing its own work shares its own blind spots.** A second family sees what the first can't. That part just works.
- **Reviewers disagree confidently, so you need a referee rule:** trust neither, verify at the source, classify each finding as real-and-new, already-covered, or misread. Without it you're laundering opinions.
- **The best catch was a money-path bug** one model planned and another caught — found by reasoning about *who holds a token when the code runs*, not by reading the diff.
- **The worst miss was a confident wrong verdict.** Treat go/no-go labels as noise; weight the evidence underneath. A frontier model's "no" is a pointer to something you should read, not a decision.
- **Know when to stop.** Count the real findings per round. When the curve flattens to polish, the remaining unknowns are empirical — they live in logs, not in another review pass.

The reflex to add one more reviewer is a good one. The discipline to referee them, and the judgment to stop, is the part that actually keeps the bug out of production.

_Running multi-model reviews on your own work? I'd love to hear what referee rules you've landed on — and which model has surprised you, in either direction. Find me on Threads – [@tony_crusoe](https://www.threads.com/@tony_crusoe)_
