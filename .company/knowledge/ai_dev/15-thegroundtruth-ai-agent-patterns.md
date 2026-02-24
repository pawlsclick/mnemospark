# 6 Patterns for Building Workflow AI Agents - The Ground Truth (Substack)

**Source:** https://thegroundtruth.substack.com/p/ai-agent-patterns

**Author:** Zhu Liang | Jan 27, 2026

---

I spent the last two months building an AI agent using the Claude Agent SDK to make short-form vertical videos. The agent handles everything from sourcing content to generating scripts, adding B-roll, selecting music, and composing the final videos.

Here are the 6 patterns that I learned from building this agent.

## 1. Decompose Work with Sub-Agents and Skills

I started off with one agent that did everything. It quickly became clear that the agent was trying to do too much at once. While the key was to break down its work, the best way to do so was not immediately obvious.

I tried separate agents, sub-agents, and skills. Ultimately, I found it useful to think about decomposition in two ways: **sub-agents** and **skills**.

- **Sub-agents** are for completely different tasks within a larger workflow. For my project: one agent for discovering content, another for creating the video. Each sub-agent has its own system prompt and runs in a separate session.

- **Skills** are for smaller steps within a single task. My video creation agent uses skills like `/selecting-broll` to find footage or `/selecting-music` to choose audio. Skills are loaded only when needed and share the context with the main agent.

Like prompts, **skills can be composed from parts or dynamically generated** before agent invocation. This helps if you want to dynamically adjust skills based on a catalog or knowledge base.

## 2. CLI as a Universal Interface

I decided to skip building a **GUI** at the beginning, based on previous experience of spending too much time on GUI development.

A traditional approach—GUI for humans and separate **tools** for agents—doubles the development work. I built a **CLI** instead. This single interface could be used by both me and the agent, making development faster and debugging far easier.

When my agent ran into an issue, I could reproduce it by running the exact same command it used, e.g. `./cli compose`. This removed the guesswork of whether the agent's tool call was different from a human's action. A single CLI served as the universal interface for everyone.

You can also **expose different LLM models as CLI commands** for specialized tasks. For example, I use Gemini 2.5 Pro for the review-video command because it is better at analyzing videos than other models.

After the agent baseline stabilized, I then added a GUI for human-in-the-loop tasks like reviewing drafts and making fine-grained adjustments.

## 3. Guide Agents with a Status Command

Another important decision was how the agent decided what to do next. Isolated stages with their own context led to missing context in later stages and made it hard to revise work from previous stages. Letting the agent figure out priorities on its own led to unpredictable behavior.

The solution was a **dedicated status command** that guides the agent to the next action. By having the agent call status, execute the action, and then call status again, we embed a **predictable state machine** within the agent loop. The command's output centralizes all the priority and workflow logic.

The `status` command outputs **Next Step** instructions following this priority:

1. Fix rejected video: if any rejected videos exist
2. Compose: if a clip has drafts with a human pick
3. Awaiting selection: if drafts exist but no human pick yet
4. Generate drafts: if available clips have no drafts

Now the agent can proactively look at the status and decide what to do next, while also being flexible to whatever workflow the user wants to run via custom prompts.

## 4. Accept the Natural Variance of Models

I thought I could get consistent output from an LLM by refining my prompts, but it didn't work. After weeks of trying to fix the last 15% of issues, I measured the model's variance. I ran the same prompt on the same input 10 times and found results varied between **76% and 88% success rate**.

This shows there is a **natural ceiling for consistency** with current LLMs. So I stopped chasing perfection and **embraced this natural variance**.

I designed the system to work with it by: generating **multiple options** (with varied prompts and parameters) and adding a **human selection process** to pick the best one. The evaluation system first picked a few promising candidates, and then I selected the best one for the next step.

## 5. Hybrid Validation with Code and LLM

Evaluating the output of the agent and aligning it with human preference was tricky. The biggest improvement in quality came when I **combined LLMs with simple code** during the evaluation process.

Use the **LLM for nuanced judgments** and **code to enforce hard rules**, then use a **weighted sum** to calculate the final score. This brought alignment with human judgment from **73% to 92%**.

## 6. Read the Logs

**Recording and reading the agent's logs** was a highly effective way to improve agent performance. Reading the steps the agent took, especially when it failed, revealed problems I would not have discovered otherwise.

For example, the logs showed the agent was trying to compose a video three times before succeeding. The issue was an FFmpeg error when too many video overlays were used. I added a validation step to prevent this from happening again.

The logs also helped find smaller inefficiencies, e.g. the agent calling `music list` when the data was already in its context. Reading the logs regularly became a core part of my development process. **It is the best way to understand what your agent is actually doing.**

---

Not all of these patterns are relevant for all use cases. Some might become outdated in a few months. It is important to experiment, iterate, and learn from your own experiences.
