# How to Write Effective Prompts for AI Agents using Langbase - freeCodeCamp

**Source:** https://www.freecodecamp.org/news/how-to-write-effective-prompts-for-ai-agents-using-langbase/

---

Prompt engineering isn't just a skill these days – it gives you an important competitive edge in your development.

In 2025, the difference between AI agents that work and those that don't comes down to how well they're prompted. Whether you're a developer, product manager, or just building with AI, getting really good at prompt engineering will make you significantly more effective.

Langbase lets you craft high-performance prompts and deploy serverless AI agents optimized for the latest models. In this article, we'll break down tips and tricks to help you design effective prompts. We'll also look at some advanced prompt engineering techniques for building serverless agents, and how to fine-tune LLM parameters to get the best results.

### Prerequisites

To get the most out of this article, you'll need:

- A Langbase account – Sign up if you haven't already.
- Basic knowledge of LLMs, AI agents, and RAG (retrieval-augmented generation).

### Here's what I'll cover:

- Prompt engineering fundamentals
- Tips and tricks for effective prompt design
- Langbase pipe agent prompts
- How to prompt engineer your AI agent
- Fine-tune LLM model's response parameters

## Prompt Engineering Fundamentals

A prompt tells the AI what to do—it sets the context, guides the response, and shapes the conversation. Prompt engineering is about designing prompts that make AI agents actually useful in real-world applications.

Here's how to write good prompts:

### 1. Define your goal clearly

Before crafting a prompt, be clear about what you want to achieve—just like planning logic before writing code. Consider whether dynamic inputs are needed and how they'll be handled. Define the ideal output format, whether JSON, XML, or plain text. Determine if the model requires additional context or if its training data is enough.

Set any constraints on response length, structure, or tone. Fine-tune LLM parameters if necessary to improve control. The more precise your goals, the better the results. And remember, effective prompt engineering is often a team effort.

### 2. Experiment relentlessly

LLMs aren't perfect, and neither is prompt engineering. Test everything. Try different formats, tweak parameters, and provide examples. AI models vary in capability—refining prompts through iteration is the only way to ensure reliable outputs.

### 3. Treat LLMs like machines, not humans

LLMs don't think. They follow instructions—precisely. Ambiguity confuses them. Over-explaining can be just as bad as under-explaining. And remember: LLMs will generate an answer, even if it's wrong. You have to manage this risk.

**Over-explaining:** _"Can you please, if possible, provide a very detailed yet concise explanation about how neural networks work, but not too technical, and try to be engaging, but also keep it short?"_

**Better prompt:** _"Explain neural networks in simple terms, under 100 words, with an analogy."_

**Under-explaining:** _"Tell me about neural networks."_

**Better prompt:** _"Describe neural networks in two sentences with an example."_

## Tips and Tricks for Effective Prompt Design

- **Be specific** – Vague prompts lead to bad outputs. Define the format, tone, and level of detail you want. If needed, break complex tasks into smaller steps and chain your prompts.

- **Control response length** – If you need a concise response, specify the word or character limit. For example: _"Summarize this in 50 words."_

- **Provide context** – LLMs don't know everything. If the model needs specific knowledge, include it in your prompt. For dynamic context, use a RAG-based approach to inject relevant information on demand.

- **Use step-by-step reasoning** – If a task requires logical reasoning, instruct the model explicitly: _"Think step by step before answering."_ This improves accuracy.

- **Separate instructions from context** – Long prompts can get messy. Start with clear instructions, then separate additional info.

- **Tell it what to do, not what to avoid** – Instead of saying, "Don't explain the answer," say, "Only output the final answer." Positive instructions work better.

- **Set constraints** – Define limits on tone, length, or complexity. Example: _"Write in a professional tone, under 3 sentences."_

- **Assign a role** – LLMs perform better with a defined persona. Start with, "You are an expert in X," for example, to guide the model's behavior.

- **Use examples** – If precision matters, show the model what you expect. Techniques like few-shot and chain-of-thought (CoT) prompting help improve complex reasoning.

## Langbase Pipe Agent Prompts

AI agents aren't just chatbots—they reason, plan, and take action based on user inputs. Unlike simple LLM queries, AI agents operate autonomously, making decisions and interacting with external tools to complete tasks.

**Langbase Pipe Agents** are serverless AI agents with unified APIs for every LLM. They let developers define structured prompts to control agent behavior across different models.

### The three key prompts in Langbase Pipe agents

1. **System prompt:** Defines the LLM model's role, tone, and guidelines before processing user input.
2. **User prompt:** The input given by the user to request a response from the model.
3. **AI assistant prompt:** The model's generated response based on the user's input.

## How to Prompt Engineer Your AI Agent

### 1. Few-shot training

Few-shot prompting improves an AI agent's ability to generate accurate responses by providing it with a few examples before asking it to perform a task. Instead of relying purely on pre-trained knowledge, the model learns from sample interactions, helping it generalize patterns and reduce errors.

### 2. Memory-augmented prompting (RAG-based)

Memory-Augmented Prompting (RAG-Based) enhances AI responses by retrieving relevant external data instead of relying solely on pre-trained knowledge. This approach is particularly useful when dealing with dynamic or domain-specific information.

Using Langbase, you can create memory agents. Langbase memory agents are a managed context search API for developers. They combine vector storage, RAG (Retrieval-Augmented Generation), and internet access to help you build powerful AI features and products.

### 3. Chain of Thought (CoT) prompting

CoT prompting helps AI agents break down complex problems into logical steps before answering. Instead of jumping to conclusions, the model is guided to reason through the problem systematically.

This prompting technique is great when you need the "how" behind the answer. It is especially useful for tasks requiring multi-step reasoning, such as debugging code.

### 4. Role-based prompting

Role-based prompting helps AI agents generate more precise and context-aware responses by assigning them a specific identity. Instead of providing generic answers, the model adopts the characteristics of a domain expert, leading to better accuracy and relevance.

### 5. ReACT (Reasoning + Acting) prompting

This enables AI agents to make decisions by alternating between logical reasoning and real-world actions. Instead of generating static responses, the model interacts dynamically with tools, APIs, or databases to fetch and process information.

This approach ensures the agent doesn't hallucinate results—it retrieves real data, evaluates it, and adjusts its actions accordingly.

### 6. Safety prompts

Langbase AI studio has a separate section that lets you define safety prompts inside a Pipe agent. For instance, do not answer questions outside of the given context. One use case can be to ensure the LLM does not provide any sensitive information in its response from the provided context.

## How to Fine-Tune the LLM's Response Parameters

- **Precise:** Tuned for precise and accurate responses.
- **Balanced:** Strikes a balance between accuracy and creativity.
- **Creative:** Prioritizes creativity and diversity in the generated responses.
- **Custom:** Allows you to manually configure the response parameters.
- **JSON_mode:** Ensures the model will always output valid JSON.
- **Temperature:** Control how creative the LLM is with the outputs.
- **Max_tokens:** Specifies the maximum number of tokens that can be generated in the output.
- **Frequency Penalty:** Prevents the model from repeating a word that was too recently used/used too often.
- **Presence Penalty:** Prevents the model from repeating a word.
- **Top_p:** Generate tokens until the cumulative probability exceeds the chosen threshold.

## Wrapping Up

Building effective serverless AI agents becomes easier if you use these prompt engineering techniques. You can give it a try by creating your own Pipe agent by visiting pipe.new.
