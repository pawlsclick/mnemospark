# Best Practices for Building Agentic AI Systems: What Actually Works in Production - UserJot

**Source:** https://userjot.com/blog/best-practices-building-agentic-ai-systems

---

I've been experimenting with adding AI agents to [UserJot](https://userjot.com/), our feedback, roadmap, and changelog platform. Not the simple "one prompt, one response" stuff. Real agent systems where multiple specialized agents communicate, delegate tasks, and somehow don't crash into each other.

The goal was to analyze customer feedback at scale, find patterns across hundreds of posts, and auto-generate changelog entries. I spent weeks reverse engineering tools like Gemini CLI and OpenCode, running experiments, breaking things, fixing them, breaking them again. Just pushed a basic version to production as beta, and it's mostly working.

Here's what I learned about building agent systems from studying what works in the wild and testing it myself.

## The Two-Tier Agent Model That Actually Works

Forget complex hierarchies. You need exactly two levels:

**Primary Agents** handle the conversation. They understand context, break down tasks, and talk to users. Think of them as project managers who never write code.

**Subagents** do one thing well. They get a task, complete it, return results. No memory. No context. Just pure function execution.

I tried three-tier systems, four-tier systems, agents talking to agents talking to agents. It all breaks down. Two tiers works best.

Here's what I landed on:

```
User → Primary Agent (maintains context)
         ├─→ Research Agent (finds relevant feedback)
         ├─→ Analysis Agent (processes sentiment)
         └─→ Summary Agent (creates reports)
```

Each subagent runs in complete isolation while the primary agent handles all the orchestration.

## Stateless Subagents: The Most Important Rule

Every subagent call should be like calling a pure function with the same input producing the same output, no shared memory, no conversation history, no state.

This sounds limiting until you realize what it gives you:

- **Parallel execution**: Run 10 subagents at once without them stepping on each other
- **Predictable behavior**: Same prompt always produces similar results
- **Easy testing**: Test each agent in isolation
- **Simple caching**: Cache results by prompt hash

Here's how I structure subagent communication:

```
// Primary → Subagent
{
  "task": "Analyze sentiment in these 50 feedback items",
  "context": "Focus on feature requests about mobile app",
  "data": [...],
  "constraints": {
    "max_processing_time": 5000,
    "output_format": "structured_json"
  }
}

// Subagent → Primary
{
  "status": "complete",
  "result": {
    "positive": 32,
    "negative": 8,
    "neutral": 10,
    "top_themes": ["navigation", "performance", "offline_mode"]
  },
  "confidence": 0.92,
  "processing_time": 3200
}
```

No conversation history or state, just task in and result out.

## Task Decomposition: How to Break Things Down

You've got two strategies that work:

**Vertical decomposition** for sequential tasks:

```
"Analyze competitor pricing" →
  1. Gather pricing pages
  2. Extract pricing tiers
  3. Calculate per-user costs
  4. Compare with our pricing
```

**Horizontal decomposition** for parallel work:

```
"Research top 5 competitors" →
  ├─ Research Competitor A
  ├─ Research Competitor B
  ├─ Research Competitor C
  ├─ Research Competitor D
  └─ Research Competitor E
  (all run simultaneously)
```

The trick is knowing when to use which: sequential when there are dependencies, parallel when tasks are independent, and you can mix them when needed.

I'm using mixed decomposition for feedback processing:

1. **Phase 1 (Parallel)**: Categorize feedback, extract sentiment, identify users
2. **Phase 2 (Sequential)**: Group by theme → Prioritize by impact → Generate report

Works every time.

## Communication Protocols That Don't Suck

Your agents need structured communication. Not "please analyze this when you get a chance." Actual structured protocols.

Every task from primary to subagent needs:

- Clear objective ("Find all feedback mentioning 'slow loading'")
- Bounded context ("From the last 30 days")
- Output specification ("Return as JSON with id, text, user fields")
- Constraints ("Max 100 results, timeout after 5 seconds")

Every response from subagent to primary needs:

- Status (complete/partial/failed)
- Result (the actual data)
- Metadata (processing time, confidence, decisions made)
- Recommendations (follow-up tasks, warnings, limitations)

Everything uses structured data exchange with clear specifications.

## Agent Specialization Patterns

After studying OpenCode and other systems, I've found three ways to specialize agents that make sense:

**By capability**: Research agents find stuff. Analysis agents process it. Creative agents generate content. Validation agents check quality.

**By domain**: Legal agents understand contracts. Financial agents handle numbers. Technical agents read code.

**By model**: Fast agents use Haiku for quick responses. Deep agents use Opus for complex reasoning. Multimodal agents handle images.

Don't over-specialize. I started with 15 different agent types but now I have 6, each doing one thing really well.

## Orchestration Patterns We Actually Use

Here are the four patterns that handle 95% of cases:

### Sequential Pipeline

Each output feeds the next input. Good for multi-step processes.

```
Agent A → Agent B → Agent C → Result
```

I use this for report generation: gather data → analyze → format → deliver.

### MapReduce Pattern

Split work across multiple agents, combine results. Good for large-scale analysis.

```
       ┌→ Agent 1 ─┐
Input ─┼→ Agent 2 ─┼→ Reducer → Result
       └→ Agent 3 ─┘
```

This is my go-to for feedback analysis in UserJot.

### Consensus Pattern

Multiple agents solve the same problem, compare answers. Good for critical decisions.

```
      ┌→ Agent 1 ─┐
Task ─┼→ Agent 2 ─┼→ Voting/Merge → Result
      └→ Agent 3 ─┘
```

### Hierarchical Delegation

Primary delegates to subagents, which can delegate to sub-subagents. Good for complex domains. Honestly, I rarely use this. Stick to two levels max.

## Context Management Without the Mess

How much context should subagents get? Less than you think.

**Level 1: Complete Isolation**: Subagent gets only the specific task. Use this 80% of the time.

**Level 2: Filtered Context**: Subagent gets curated relevant background. Use when task needs some history.

**Level 3: Windowed Context**: Subagent gets last N messages. Use sparingly, usually breaks things.

Less context = more predictable behavior.

## Error Handling That Actually Handles Errors

**Graceful degradation chain**:

1. Subagent fails → Primary agent attempts task
2. Still fails → Try different subagent
3. Still fails → Return partial results
4. Still fails → Ask user for clarification

**Retry strategies that work**:

- Immediate retry for network failures
- Retry with rephrased prompt for unclear tasks
- Retry with different model for capability issues
- Exponential backoff for rate limits

Always return something useful, even when failing.

## Performance Optimization Without Overthinking

**Model selection**: Simple tasks get Haiku. Complex reasoning gets Sonnet. Critical analysis gets Opus. Don't use Opus for everything.

**Parallel execution**: Identify independent tasks. Launch them simultaneously. I regularly run 5-10 agents in parallel.

**Caching**: Cache by prompt hash. Saves 40% of API calls.

**Batching**: Process 50 feedback items in one agent call instead of 50 separate calls.

## The Principles That Matter

1. **Stateless by default**: Subagents are pure functions
2. **Clear boundaries**: Explicit task definitions and success criteria
3. **Fail fast**: Quick failure detection and recovery
4. **Observable execution**: Track everything, understand what's happening
5. **Composable design**: Small, focused agents that combine well

## Common Pitfalls I Hit (So You Don't Have To)

**The "Smart Agent" Trap**: Be explicit.

**The State Creep**: "Just this one piece of state." Then everything breaks.

**The Deep Hierarchy**: Four levels of agents seemed logical. It was a debugging nightmare.

**The Context Explosion**: Passing entire conversation history to every agent. Tokens aren't free.

**The Perfect Agent**: Just make more specialized agents.

## Actually Implementing This

Start simple with one primary agent and two subagents, get that working, then add agents as needed rather than just because you can.

Build monitoring from day one. You'll need it.

Test subagents in isolation. If they need context to work, they're not isolated enough.

Cache aggressively. Same prompt = same response = why call the API twice?

And remember: agents are tools, not magic.
