# Prompt: audit the public-following story

Use this prompt for the existing product. Product behavior and evidence rules remain owned by the repository skill and release-readiness documents.

```text
Role:
Act as OrbitDiff's product marketer, usability auditor, and release reviewer.

Context:
The product already exists. Lead with the reader's question: "Who did they
follow?" The founder has chosen relationship curiosity as the positioning:
someone may want to see whether a crush or partner started following a new
public account. This is a chosen audience hypothesis, not customer research.

Inputs:
Read README.md, .agents/product-marketing-context.md, CONTEXT.md,
skills/orbitdiff/SKILL.md, its safety and scheduling references,
docs/release-readiness.md, the existing usability audit, and newcomer pilot.
Compare relevant source with the release advertised in the installation steps.
Use prompt-engineering and prompt-engineering-patterns for this process;
writing-for-agents for agent instructions; product-marketing-context,
customer-research, page-cro, copywriting, and copy-editing for the story.
Open the available skill files before applying them.

Task:
Audit and improve the GitHub story, first-use guidance, and brand imagery.
Help readers understand which public account appeared, what changed, and
what the observation dates mean. Preserve the existing installation routes.

Process:
1. Build a claim-to-evidence matrix from current source and the advertised
   release. Distinguish implemented behavior, verified use, and unknowns.
2. Walk the newcomer journey: promise, example, first action, setup, result,
   and recovery. Add findings to the existing register with evidence,
   severity, classification, smallest fix, and an observable acceptance test.
3. Lead with public following changes and a concrete relationship-curiosity
   use case. Keep personal export interpretation as a separate secondary
   benefit. Use one primary action: try the isolated offline demo.
4. Generate matching imagery with ChatGPT Image. Use fictional handles,
   legible text, and a visible synthetic-illustration label. Inspect the
   actual output and GitHub crop before publishing it.
5. Apply two bounded copy-review passes for clarity, specificity, proof,
   relevance, and action. Recheck every changed claim against the matrix.
6. Personally review the final diff. Run the repository's applicable tests,
   static checks, package checks, and skill validation with existing tools.
   Identify candidate evidence and exact-commit CI separately from release
   evidence. Verify GitHub rendering and any changed metadata after applying.

Examples:
Accurate: "See when a public following change was first observed and later
confirmed." Unsupported: "Know exactly when they tapped Follow."
Accurate: "A public account appeared in their following list."
Unsupported: "This proves attraction, cheating, or who that person is."

Quality bar:
A newcomer can explain the main benefit, the input needed, the next action,
and the result's limits. Public events need two matching complete observations
of the same change after a baseline. Personal exports are snapshot observations,
never live-confirmed events. Keep those sources distinct in copy and examples.

Constraints:
Work within the authorized documentation and asset boundary. Use existing
runtime behavior; leave concurrent source work intact. Keep Instagram untouched.
Describe observation times rather than exact action times; scope history to
observations after setup. Keep gender, identity, motives, and relationship
judgments unknown. Explain daily scheduling as a separate, explicit step after
a verified manual live workflow. Installation and demos prove only their own
checks. Keep live readiness and unrun host discovery labeled Unproven.

Output format:
Return the applied changes, finding IDs, verified commit and commands, image
provenance, GitHub links, and remaining gates. Label the outcome success,
partial, blocked, error, or no_work. Report human usability as Unproven until
real participant sessions exist. Use the neutral pilot to collect that evidence.
```
