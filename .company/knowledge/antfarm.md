Antfarm team

Antfarm project: ./antfarm_gitingest.txt

Antfarm is a specialized framework designed to orchestrate "swarms" of sub-agents to handle complex workflows. Based on the file structure I just audited, you have three primary Workflows available, each with its own dedicated team of agents:

1. Feature Development Swarm (feature-dev)

This is your "Dev Shop" in a box. It's designed to take a feature request from concept to tested code.

• The Planner: Analyzes the request and breaks it down into a technical execution plan.
• The Developer: Writes the actual code based on the plan.
• The Reviewer: Performs a "code review" to ensure quality and adherence to standards.
• The Tester: Validates the implementation and ensures no regressions were introduced.

2. Bug Fix Swarm (bug-fix)

Use this when something is broken. It’s optimized for troubleshooting and repair.

• The Triager: Categorizes the bug and determines its priority and scope.
• The Investigator: Dives into the logs/code to find the root cause (the "why").
• The Fixer: Implements the specific patch to resolve the issue.

3. Security Audit Swarm (security-audit)

Given your background in enterprise security, this is likely your most powerful toolset.

• The Scanner: Systematically checks the codebase or environment for vulnerabilities.
• The Prioritizer: Evaluates the risk of found issues (Critical/High/Medium/Low).
• The Fixer: Proposes or implements security hardening and patches.
• The Tester: Verifies that the security fixes actually work without breaking functionality.

4. Support & Infrastructure Agents

• PR Agent: Specialized in managing Pull Requests and Git integrations.
• Verifier: Used to confirm that steps in a workflow meet "Definition of Done."
• Antfarm Medic: This is a background agent (running as a cron job) that monitors the health of your other agents and workflows to ensure they haven't stalled or errored out.
