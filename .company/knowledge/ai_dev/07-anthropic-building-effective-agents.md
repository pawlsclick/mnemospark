# Building Effective AI Agents - Anthropic

**Source:** https://www.anthropic.com/research/building-effective-agents

**Published:** Dec 19, 2024

---

We've worked with dozens of teams building LLM agents across industries. Consistently, the most successful implementations use simple, composable patterns rather than complex frameworks.

Over the past year, we've worked with dozens of teams building large language model (LLM) agents across industries. Consistently, the most successful implementations weren't using complex frameworks or specialized libraries. Instead, they were building with simple, composable patterns.

In this post, we share what we've learned from working with our customers and building agents ourselves, and give practical advice for developers on building effective agents.

## What are agents?

"Agent" can be defined in several ways. Some customers define agents as fully autonomous systems that operate independently over extended periods, using various tools to accomplish complex tasks. Others use the term to describe more prescriptive implementations that follow predefined workflows. At Anthropic, we categorize all these variations as **agentic systems**, but draw an important architectural distinction between **workflows** and **agents**:

- **Workflows** are systems where LLMs and tools are orchestrated through predefined code paths.
- **Agents**, on the other hand, are systems where LLMs dynamically direct their own processes and tool usage, maintaining control over how they accomplish tasks.

## When (and when not) to use agents

When building applications with LLMs, we recommend finding the simplest solution possible, and only increasing complexity when needed. This might mean not building agentic systems at all. Agentic systems often trade latency and cost for better task performance, and you should consider when this tradeoff makes sense.

When more complexity is warranted, workflows offer predictability and consistency for well-defined tasks, whereas agents are the better option when flexibility and model-driven decision-making are needed at scale. For many applications, however, optimizing single LLM calls with retrieval and in-context examples is usually enough.

## When and how to use frameworks

There are many frameworks that make agentic systems easier to implement, including: The Claude Agent SDK; Strands Agents SDK by AWS; Rivet (drag and drop GUI LLM workflow builder); and Vellum (another GUI tool for building and testing complex workflows).

These frameworks make it easy to get started by simplifying standard low-level tasks like calling LLMs, defining and parsing tools, and chaining calls together. However, they often create extra layers of abstraction that can obscure the underlying prompts and responses, making them harder to debug. They can also make it tempting to add complexity when a simpler setup would suffice.

We suggest that developers start by using LLM APIs directly: many patterns can be implemented in a few lines of code. If you do use a framework, ensure you understand the underlying code. Incorrect assumptions about what's under the hood are a common source of customer error.

See our cookbook for some sample implementations.

## Building blocks, workflows, and agents

### Building block: The augmented LLM

The basic building block of agentic systems is an LLM enhanced with augmentations such as retrieval, tools, and memory. Our current models can actively use these capabilities—generating their own search queries, selecting appropriate tools, and determining what information to retain.

We recommend focusing on two key aspects of the implementation: tailoring these capabilities to your specific use case and ensuring they provide an easy, well-documented interface for your LLM. One approach is through our recently released Model Context Protocol (MCP), which allows developers to integrate with a growing ecosystem of third-party tools with a simple client implementation.

### Workflow: Prompt chaining

Prompt chaining decomposes a task into a sequence of steps, where each LLM call processes the output of the previous one. You can add programmatic checks ("gate") on any intermediate steps to ensure that the process is still on track.

**When to use this workflow:** This workflow is ideal for situations where the task can be easily and cleanly decomposed into fixed subtasks. The main goal is to trade off latency for higher accuracy, by making each LLM call an easier task.

**Examples:** Generating marketing copy then translating it; writing an outline, checking criteria, then writing the document.

### Workflow: Routing

Routing classifies an input and directs it to a specialized followup task. This workflow allows for separation of concerns, and building more specialized prompts.

**When to use this workflow:** Routing works well for complex tasks where there are distinct categories that are better handled separately, and where classification can be handled accurately.

**Examples:** Directing different types of customer service queries into different downstream processes; routing easy questions to Haiku and hard questions to Sonnet.

### Workflow: Parallelization

LLMs can sometimes work simultaneously on a task and have their outputs aggregated programmatically. Two key variations:

- **Sectioning**: Breaking a task into independent subtasks run in parallel.
- **Voting:** Running the same task multiple times to get diverse outputs.

**Examples:** Guardrails (one model processes queries, another screens content); code review with multiple prompts; evaluating content with multiple vote thresholds.

### Workflow: Orchestrator-workers

A central LLM dynamically breaks down tasks, delegates them to worker LLMs, and synthesizes their results.

**When to use this workflow:** Well-suited for complex tasks where you can't predict the subtasks needed. The key difference from parallelization is flexibility—subtasks aren't pre-defined, but determined by the orchestrator based on the specific input.

**Examples:** Coding products that make complex changes to multiple files; search tasks that involve gathering and analyzing information from multiple sources.

### Workflow: Evaluator-optimizer

One LLM call generates a response while another provides evaluation and feedback in a loop.

**When to use this workflow:** Particularly effective when we have clear evaluation criteria, and when iterative refinement provides measurable value. Good fit when LLM responses can be demonstrably improved when a human articulates feedback, and when the LLM can provide such feedback.

**Examples:** Literary translation with evaluator critiques; complex search with multiple rounds where the evaluator decides whether further searches are warranted.

### Agents

Agents begin their work with either a command from, or interactive discussion with, the human user. Once the task is clear, agents plan and operate independently, potentially returning to the human for further information or judgement. During execution, it's crucial for the agents to gain "ground truth" from the environment at each step (such as tool call results or code execution) to assess its progress. Agents can pause for human feedback at checkpoints or when encountering blockers.

Agents can handle sophisticated tasks, but their implementation is often straightforward. They are typically just LLMs using tools based on environmental feedback in a loop. It is therefore crucial to design toolsets and their documentation clearly and thoughtfully.

**When to use agents:** Agents can be used for open-ended problems where it's difficult or impossible to predict the required number of steps, and where you can't hardcode a fixed path. The autonomous nature of agents means higher costs, and the potential for compounding errors. We recommend extensive testing in sandboxed environments, along with the appropriate guardrails.

**Examples:** A coding agent to resolve SWE-bench tasks; "computer use" reference implementation where Claude uses a computer to accomplish tasks.

## Combining and customizing these patterns

These building blocks aren't prescriptive. They're common patterns that developers can shape and combine to fit different use cases. The key to success is measuring performance and iterating on implementations. Add complexity _only_ when it demonstrably improves outcomes.

## Summary

Success in the LLM space isn't about building the most sophisticated system. It's about building the _right_ system for your needs. Start with simple prompts, optimize them with comprehensive evaluation, and add multi-step agentic systems only when simpler solutions fall short.

When implementing agents, we try to follow three core principles:

1. Maintain **simplicity** in your agent's design.
2. Prioritize **transparency** by explicitly showing the agent's planning steps.
3. Carefully craft your agent-computer interface (ACI) through thorough tool **documentation and testing**.

Frameworks can help you get started quickly, but don't hesitate to reduce abstraction layers and build with basic components as you move to production.

## Appendix 1: Agents in practice

### A. Customer support

Customer support combines familiar chatbot interfaces with enhanced capabilities through tool integration. Support interactions naturally follow a conversation flow while requiring access to external information and actions; tools can pull customer data, order history, and knowledge base articles; actions such as issuing refunds or updating tickets can be handled programmatically; success can be clearly measured through user-defined resolutions.

### B. Coding agents

Code solutions are verifiable through automated tests; agents can iterate on solutions using test results as feedback; the problem space is well-defined and structured; output quality can be measured objectively. Human review remains crucial for ensuring solutions align with broader system requirements.

## Appendix 2: Prompt engineering your tools

Tools enable Claude to interact with external services and APIs. Tool definitions and specifications should be given just as much prompt engineering attention as your overall prompts.

Suggestions for deciding on tool formats:

- Give the model enough tokens to "think" before it writes itself into a corner.
- Keep the format close to what the model has seen naturally occurring in text on the internet.
- Make sure there's no formatting "overhead" (e.g., accurate line counts, string-escaping code).

Invest as much effort in agent-computer interfaces (ACI) as in human-computer interfaces (HCI):

- Put yourself in the model's shoes. Include example usage, edge cases, input format requirements, and clear boundaries from other tools.
- Change parameter names or descriptions to make things more obvious—like writing a great docstring for a junior developer.
- Test how the model uses your tools: run many example inputs to see what mistakes the model makes, and iterate.
- Poka-yoke your tools: change the arguments so that it is harder to make mistakes.

While building our agent for SWE-bench, we spent more time optimizing our tools than the overall prompt. For example, we found that the model would make mistakes with tools using relative filepaths after the agent had moved out of the root directory. To fix this, we changed the tool to always require absolute filepaths—and the model used this method flawlessly.
