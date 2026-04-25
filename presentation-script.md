# ClearTerms — 10-Minute Presentation Script

---

## SLIDE 1: Title (~30 sec)

Hey everyone. My name is Fedor, and today I want to tell you about ClearTerms — an AI-powered tool that helps small businesses understand their contracts before they sign them. No lawyers needed, no legal jargon. Just plain English.

---

## SLIDE 2: The Problem (~1 min 30 sec)

So let me start with the problem. If you run a small business in the US, you sign contracts all the time. Leases, vendor agreements, partnership deals, NDAs. And here is the thing — 73 percent of small business owners sign these contracts without a full legal review. Why? Because lawyers charge 300 dollars an hour or more. Most small businesses just can't afford that for every single document.

And it costs them. The average cost of one bad clause in a contract is about 12 thousand dollars. That could be an auto-renewal you didn't notice, or an early termination penalty that hits you when you try to leave a lease.

So there is this catch-22. You can't afford a lawyer for every contract. But you also can't afford NOT to review them. Small business owners need something fast, cheap, and easy to understand.

---

## SLIDE 3: The Solution (~1 min 30 sec)

That is where ClearTerms comes in. The idea is simple. You upload your contract — it can be a PDF, a Word document, or even a photo of a printed contract. Our system extracts the text, runs it through AI, and gives you a full report in about 60 seconds.

The report is in plain English. No legal terms you need to Google. It gives you a risk score from 1 to 10, a summary of what the contract actually says, a list of things that are good for you, things that are bad for you, and specific risks flagged as high, medium, or low.

And after that, you can chat with the AI about the contract. You can ask things like "What happens if I break the lease early?" or "Is this rent increase normal?" It is like having a conversation with someone who actually read the whole thing.

---

## SLIDE 4: Product Demo (~1 min)

Here is what the report actually looks like. This is an example — an office lease agreement. You can see the risk score is 6.2, which is moderate risk. The summary tells you it is a 3-year lease, 4200 a month, with a 5 percent annual increase.

On the left you see the good stuff — 60-day grace period, free parking, subletting allowed. On the right, the bad stuff — the rent increase is above market average, there is a 6-month early termination penalty, and the landlord can actually relocate you within the building.

Then below, the vulnerabilities. The high-risk one here is that the landlord can terminate with just 30 days notice for any business reason. That is something you would definitely want to negotiate before signing.

---

## SLIDE 5: Market (~1 min)

Now let me talk about the market. Legal tech is a 35 billion dollar market and it is growing at 17 percent a year. There are 33 million small businesses in the US alone.

If you look at what exists today, there is a big gap. At the top, you have enterprise tools like Ironclad and Evisort — they cost 500 to 2000 dollars a month. Way too expensive for a small business. At the bottom, you have consumer tools like DoNotPay — they are cheap but very basic, not built for business contracts.

ClearTerms sits right in the middle — 29 to 99 dollars a month. Affordable for a small business, but powerful enough to actually be useful.

---

## SLIDE 6: Competition (~1 min)

How do we compare to competitors? I made a simple comparison table. ClearTerms is the only tool that combines all of these: full AI analysis, plain English reports, affordable pricing, follow-up chat, risk scoring, and support for scanned documents.

LegalZoom does attorney connections but no AI analysis. DoNotPay has some AI but it is shallow and consumer-focused. Enterprise CLMs have everything but cost 10 to 20 times more. We bring enterprise-level analysis at a small business price.

---

## SLIDE 7: Business Model (~1 min)

The business model is straightforward. We have three subscription tiers. Starter at 29 dollars a month for 5 documents. Professional at 79 for 20 documents — that is our main plan. And Business at 199 for 50 documents.

There is also a pay-per-document option at 15 dollars if someone does not want a subscription. And the first document is free, no credit card needed. That is how we get people in the door.

Phase two is an attorney marketplace. When the AI flags something serious, we connect the user with a real lawyer and take a commission. That is the second revenue engine.

---

## SLIDE 8: Unit Economics (~45 sec)

The economics work well. Each AI analysis costs us between 50 cents and 2 dollars to run. That gives us gross margins of 75 to 85 percent, which is standard for SaaS. Customer acquisition cost is around 15 to 25 dollars. And the lifetime value to CAC ratio is above 3 to 1.

For revenue projections — conservatively, we are looking at 2K per month at month 3, growing to 25K at month 12, and 60K at month 18. Breakeven is at about 60 paying users.

---

## SLIDE 9: Compliance (~1 min)

Now, one question you might have is — is this legal? Are we practicing law? No. And we are very careful about that.

The AI never uses words like "should," "recommend," or "advise." It says "analysis indicates," "consider," "note that." We are an information tool, not a law firm.

We have a 6-layer protection system. Terms of service agreement at signup, reminders on every upload, disclaimers on every report, chat reminders every 5 messages, watermarks on PDF exports, and hardcoded guardrails in the AI itself.

Privacy is also built in. Documents are encrypted, auto-deleted after 30 days, and never used for AI training. We are on a SOC 2 compliance path from day one.

---

## SLIDE 10: Tech Stack (~30 sec)

Quick note on the tech. We are built on Next.js with TypeScript, using Claude API for the AI analysis and Google Cloud Vision for OCR. Everything is serverless on Vercel, database on Supabase, payments through Stripe. Total infrastructure cost at launch is about 200 to 500 dollars a month. One person can run this.

---

## SLIDE 11: Go-to-Market (~45 sec)

For go-to-market, we have three phases. Phase one is seeding — Reddit, LinkedIn, Product Hunt, building in public. Zero budget, target 50 users.

Phase two is organic growth — SEO, partnerships with platforms like QuickBooks and WeWork, and a referral program. Budget is 500 a month, target 500 users.

Phase three is paid scaling — Google Ads, LinkedIn Ads, growing the attorney marketplace. Budget is 2500 a month, target 2000-plus users.

Our funnel targets: 15 to 20 percent visitor-to-signup, 60 to 70 percent signup-to-upload, 20 to 30 percent trial-to-paid, and 70 to 80 percent three-month retention.

---

## SLIDE 12: Roadmap & Close (~30 sec)

The roadmap. Phase one is the MVP — document upload, AI analysis, chat, and payments. That is 6 to 8 weeks. Phase two adds the attorney marketplace. Phase three adds portfolio management, an iOS app, and team accounts.

The bottom line: ClearTerms helps small businesses understand every contract before they sign. 35 billion dollar market, 75 to 85 percent margins, starting at 29 dollars a month. Thank you.

---

## Q&A Tips

If asked "How is this different from just using ChatGPT?":
> ChatGPT gives you a general answer. We give you a structured report with risk scoring, specific clause analysis, and compliance guardrails. Plus you can't upload a photo of a contract to ChatGPT and get a color-coded risk report.

If asked "What about accuracy?":
> We use Claude with a 200K token context window, which means it can read entire contracts at once. Our system prompt is specifically tuned for legal analysis. And we always remind users this is informational, not legal advice.

If asked "Why not just hire a lawyer?":
> You should, for the important stuff. But most small businesses sign 10 to 20 contracts a year. You are not going to pay 300 an hour for every single one. ClearTerms handles the 80 percent that just need a quick review, and flags the 20 percent where you actually need a lawyer.
