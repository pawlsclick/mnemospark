# Agentic AI: Why Prompt Engineering Delivers Better ROI Than Orchestration - Caylent

**Source:** https://caylent.com/blog/agentic-ai-why-prompt-engineering-delivers-better-roi-than-orchestration

---

Discover what we've learned over two years of building agentic systems, from automating 30,000 facilities to streamlining enterprise cloud costs.

The industry conversation around agentic AI has reached a fever pitch, with new frameworks and orchestration patterns emerging weekly. Yet at Caylent, we've been building agent-based systems since 2023, well before the current wave of excitement. Through dozens of production deployments on Amazon Bedrock, we've learned a counterintuitive truth: **the teams that succeed focus more on prompt engineering than orchestration complexity.**

As our CTO Randall Hunt put it: "I kind of get frustrated when people jump on this term agents because the way we think about it is the same thing we've been doing the whole time — making this stuff work in the business world. It's tool use."

## When Should I Use Amazon Bedrock Provisioned Throughput?

ROI depends not just on how well your agents work, but also on how many tokens you need to pay for. Below **2 million tokens per minute** (blended input/output), on-demand pricing with aggressive optimization delivers superior economics. Above it, provisioned throughput becomes cheaper. But **you can dramatically reduce token consumption before ever considering provisioned capacity.**

- **Amazon Bedrock batch inference** provides an immediate 50% cost reduction for asynchronous workloads. No code changes, no prompt modifications.
- **Prompt Caching** (for prompts over 1,024 tokens) can reduce costs by up to 90% for cached portions while improving latency.

Example: BrainBox AI (HVAC across 30,000 buildings). Initial agent design consumed 4,000 tokens per request. Through systematic prompt optimization and strategic caching, we reduced this to 1,200 tokens while improving response quality—a **70% reduction** before batch or other optimizations.

The hidden costs matter too. Complex orchestration means more debugging time, longer iteration cycles, higher operational overhead. A simple, well-optimized agent that ships in six weeks delivers more value than a complex multi-agent system still in development after six months.

## Why Complex Orchestration Shouldn't Come First

"We perhaps overindex on the orchestration layer and don't index as high as we should on the actual prompts."

For BrainBox AI, instead of building a sophisticated multi-agent system, we built ARIA starting with the **simplest possible pattern**: a system that could spin up a code execution environment to query their various downstream systems (Athena, federated OLTP). This simple pattern handled **90% of use cases** immediately. Only after validating in production did we layer in specialized handling for edge cases.

**Lesson:** Start with the simplest viable architecture and let complexity emerge from actual requirements, not anticipated ones.

**LangGraph** has become our orchestration framework of choice precisely because it doesn't impose unnecessary structure. It provides just enough scaffolding to build reliable agents without forcing premature architectural decisions.

## The Evaluation-First Prompt Engineering Framework

"These evals that you create are the most important part of the system. This is where you define your moat."

"The evals are like the brakes on your car. They're not there to slow down. They're there so you can go faster with confidence."

**Methodology:** First comes the "vibe check"—validate that the model can handle the task. Then create your evals from the initial prompt that worked; modify, build, make it robust and more performant. The evaluation set becomes your North Star.

Example: Nature Footage generative search over video. We started with "please describe this video" and built an evaluation set of 50 video samples with human-validated descriptions. Each prompt iteration was tested against this set. "The prompts and optimizing the prompts, that's where we find the biggest improvement." The only way to reliably measure improvements is with evaluations.

When Claude 3.5 Sonnet was released on Bedrock, we ran it against existing evaluation sets across all customers. Within 48 hours we'd identified which systems would benefit from upgrading.

**Stanford's DSP (Demonstrate-Search-Predict)** is an excellent tool for optimizing against these evaluations. It uses your evaluation set to programmatically search for optimal prompts, consistently delivering **50-80% token reductions** while maintaining or improving eval scores.

**Key insight:** Prompt optimization isn't about adding more instructions—it's about finding the **Minimum Viable Tokens** that reliably pass your evaluations. We recently reduced a customer's prompt from 3,000 tokens to 890 tokens while improving eval pass rate from 82% to 96%.

## Multi-Agent Systems: When You Actually Need Them (And When You Don't)

"The orchestration layer is almost incidental." Multi-agent systems have their place, but that place is much smaller than current hype suggests.

**CloudZero** cost optimization is an example of when multi-agent architecture genuinely adds value: analyze uploaded Cost and Usage Reports, compare against benchmarks, provide optimization recommendations. We used Amazon Bedrock Agents with a critical design principle—**each agent has a narrow, well-defined responsibility**. The supervisor routes; the cost analyzer focuses on CUR data; the benchmark agent compares against similar customers. This allows independent optimization and testing. But CloudZero processes thousands of analyses daily with significant complexity. Most use cases don't require this.

## Production Monitoring: Treating Agents as Distributed Systems

"The agent is a distributed system. You have to treat it, configure it from the start like a distributed system."

- **Enable Amazon Bedrock invocation logging** from day one. "Without it, unless you have some other form of logging, it can be very difficult to debug things."
- For multi-agent systems, **trace correlation** is critical. We implement **OpenTelemetry** tracing across all components with consistent trace IDs. "You need to persist it. Tools have to know and be aware that it's coming from this OpenTelemetry ID."
- **Checkpointing state to S3** for conversation continuity when agents pause and resume (approval workflows, long-running analyses). Works well with Firecracker VMs for code interpreter environments.

## The Production-Ready Tool Stack For Agentic Systems

- **LangGraph** — primary orchestration framework; balance of flexibility and structure
- **DSP from Stanford** — prompt optimization; 50-80% token reductions while maintaining quality
- **Amazon Bedrock native features** — Knowledge Bases (no custom RAG), Guardrails (content/PII), Batch inference (50% cost reduction for async)
- **Direct Bedrock Converse API** when we need features not yet in Bedrock Agents. "For system prompts and tool use, the prompt caching is really, really valuable. So we tend to walk the street with just regular old converse stream or converse."
- **MCP (Model Context Protocol)** — we made a big bet when Anthropic released it in November 2024. "I think Anthropic got the timing right, and they got the setup right."

## Your Path to Production

1. **Start with the vibe check.** Can a frontier model handle your use case with a basic prompt? If yes, create your evaluation set immediately (20-30 examples, common + edge cases).
2. **Build the simplest viable agent.** Use Bedrock Converse API directly. Focus on prompt refinement and baseline metrics. Enable invocation logging from day one.
3. **Optimize aggressively.** Apply DSP or manual optimization against evals. Implement caching for prompts over 1,024 tokens. Evaluate batch for async workloads. Expect 50-70% cost reduction without architectural changes.
4. **Only then consider complex architectures.** If you have proven ROI and clear requirements that simple agents cannot meet, explore multi-agent patterns.

**Warning signs you're over-engineering:** Designing multi-agent before proving single-agent viability; spending more time on orchestration than prompt optimization; building for anticipated scale rather than current needs; adding agents because the architecture diagram looks impressive.

## The Bottom Line

The teams succeeding with agentic AI aren't the ones with the most sophisticated architectures. They're the ones who started simple, measured everything, and optimized relentlessly. They understand that agents are just tool use with better packaging, that **prompts matter more than orchestration**, and that production systems require distributed systems thinking from day one.

Your agents don't need complex orchestration to deliver value. They need well-crafted prompts, robust evaluation sets, and thoughtful optimization. Master these fundamentals, and you'll build systems that actually ship to production and deliver measurable business value.
