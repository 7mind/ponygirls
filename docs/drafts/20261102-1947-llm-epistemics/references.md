# References — LLM-accelerated development epistemics

Each entry records how it entered this project. **Fetched** means its page or
abstract was read during the named session; the cited figures come from that
reading. **Search-observed** means only search-result snippets were read.
**From memory** means cited from background knowledge without re-fetching;
verify before relying on details. Upgrade the provenance when a source is
actually read.

## External sources

| ID | Citation | Link | Provenance | Used in |
|---|---|---|---|---|
| R1 | Becker, Rush, Barnes, Rein (2025). *Measuring the Impact of Early-2025 AI on Experienced Open-Source Developer Productivity.* METR. RCT, 16 developers, 246 tasks; forecast −24 %, post-hoc estimate −20 %, measured +19 % completion time. | https://arxiv.org/abs/2507.09089 | Fetched (abstract), 2026-11-02 | J1 |
| R2 | METR (2026-02-24). *We are Changing our Developer Productivity Experiment Design.* Late-2025 data selection-biased; returning developers −18 % (CI −38 %..+9 %), new −4 % (CI −15 %..+9 %); self-reports "quite unreliable". | https://metr.org/blog/2026-02-24-uplift-update/ | Fetched, 2026-11-02 | J1 |
| R3 | Perry, Srivastava, Kumar, Boneh (2023). *Do Users Write More Insecure Code with AI Assistants?* CCS '23. Assistant users wrote less secure code and were more likely to believe it secure; lower trust → fewer vulnerabilities. | https://arxiv.org/abs/2211.03622 | Fetched (abstract), 2026-11-02 | J1, J2 |
| R4 | Anthropic Alignment Science (2025). *Reasoning models don't always say what they think* (paper: arXiv 2505.05410, search-observed). Hint mention 25 % (Claude 3.7 Sonnet) / 39 % (R1); trained reward hacks exploited >99 %, verbalised <2 %. | https://www.anthropic.com/research/reasoning-models-dont-say-think | Fetched (blog), 2026-11-02 | J1, J5 |
| R5 | Shen, Tamkin (2026). *How AI Impacts Skill Formation* / Anthropic blog *How AI assistance impacts the formation of coding skills*. RCT n=52, mostly junior, Trio library; quiz 50 % vs 67 % (d=0.738, p=0.01), largest gap on debugging; speed-up not significant. | https://www.anthropic.com/research/AI-assistance-coding-skills ; https://arxiv.org/abs/2601.20245 | Fetched (blog), 2026-11-02; arXiv search-observed | J1 |
| R6 | Hong et al. (2025). *Context Rot: How Increasing Input Tokens Impacts LLM Performance.* Chroma technical report. | https://www.trychroma.com/research/context-rot | Search-observed, 2026-11-02 | J1 |
| R7 | Kim, Garg, Peng, Garg (2025). *Correlated Errors in Large Language Models.* ICML 2025. >350 LLMs; models agree 60 % of the time when both err (one leaderboard). | https://arxiv.org/abs/2506.07962 | Search-observed (abstract snippet), 2026-11-02 | J1, J4, J5 |
| R8 | Von Arx, Chan, Barnes (2025). *Recent Frontier Models Are Reward Hacking.* METR. Modifying tests/scoring code, accessing reference answers. | https://metr.org/blog/2025-06-05-recent-reward-hacking/ | Search-observed, 2026-11-02 | J1, J2 |
| R9 | Konstantinou, Degiovanni, Papadakis (2024/2026). *Do LLMs generate test oracles that capture the actual or the expected program behaviour?* (v2 title: *Can we find bugs using LLM-generated oracles?*, JACM). 24 Java repositories; LLM oracles mainly capture actual behaviour. | https://arxiv.org/abs/2410.21136 | Fetched (abstract v2), 2026-11-02 | J2, J4 |
| R10 | Anthropic. *Prompting best practices*, section "Avoid focusing on passing tests and hardcoding": "Tests are there to verify correctness, not to define the solution … if any of the tests are incorrect, please inform me rather than working around them." | https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices | Fetched (markdown), 2026-11-02 | J2 |
| R11 | Panickssery, Bowman, Feng (2024). *LLM Evaluators Recognize and Favor Their Own Generations.* NeurIPS 2024. | https://arxiv.org/abs/2404.13076 | Search-observed (abstract), 2026-11-02 | J2 |
| R12 | Feng, Afroz, Sarma (2025). *From Gains to Strains: Modeling Developer Burnout with GenAI Adoption.* 442 developers, JD–R model, PLS-SEM; GenAI adoption raises burnout via job demands; resources and positive perceptions mitigate. | https://arxiv.org/abs/2510.07435 | Fetched (abstract), 2026-11-02 | J2 |
| R13 | Naur, P. (1985). Programming as Theory Building. *Microprocessing and Microprogramming* 15(5), 253–261. | — | From memory | J1 |
| R14 | Polanyi, M. (1966). *The Tacit Dimension.* "We can know more than we can tell." | — | From memory | J1, J4 |
| R15 | Knight, J. C., Leveson, N. G. (1986). An experimental evaluation of the assumption of independence in multiversion programming. *IEEE TSE* SE-12(1), 96–109. | — | From memory | J1 |
| R16 | Kahneman, D., Klein, G. (2009). Conditions for intuitive expertise: a failure to disagree. *American Psychologist* 64(6), 515–526. | — | From memory | J1, J6 |
| R17 | Chase, W. G., Simon, H. A. (1973). Perception in chess. *Cognitive Psychology* 4(1), 55–81. | — | From memory | J1 |
| R18 | Cowan, N. (2001). The magical number 4 in short-term memory. *Behavioral and Brain Sciences* 24(1), 87–114. | — | From memory | J1 |
| R19 | Johnson, M. K., Hashtroudi, S., Lindsay, D. S. (1993). Source monitoring. *Psychological Bulletin* 114(1), 3–28. | — | From memory | J1 |
| R20 | Bainbridge, L. (1983). Ironies of automation. *Automatica* 19(6), 775–779. | — | From memory | J1 |
| R21 | Sharma, M. et al. (2023). Towards Understanding Sycophancy in Language Models. arXiv 2310.13548. | — | From memory | J1 |
| R22 | Feathers, M. (2004). *Working Effectively with Legacy Code.* Prentice Hall. (Characterization tests.) | — | From memory | J2 |
| R23 | Barr, E. T., Harman, M., McMinn, P., Shahbaz, M., Yoo, S. (2015). The Oracle Problem in Software Testing: A Survey. *IEEE TSE* 41(5), 507–525. | — | From memory | J2 |
| R24 | Demerouti, E., Bakker, A. B., Nachreiner, F., Schaufeli, W. B. (2001). The job demands–resources model of burnout. *Journal of Applied Psychology* 86(3), 499–512. | — | From memory | J2 |
| R25 | Hart, S. G., Staveland, L. E. (1988). Development of NASA-TLX. In *Human Mental Workload*, North-Holland. | — | From memory | H-T4, J7 |
| R26 | Blau, Michaeli (2019). *Rethinking Lossy Compression: The Rate-Distortion-Perception Tradeoff.* ICML 2019. Requiring high perceptual quality elevates the rate–distortion curve. | https://arxiv.org/abs/1901.07821 | Fetched (abstract), 2026-11-02 | J4 |
| R27 | Yan, Wen, Ying, Ma, Liu (2021). *On Perceptual Lossy Compression: The Cost of Perceptual Reconstruction and An Optimal Training Framework.* ICML 2021. Perfect perceptual quality costs exactly double the lowest achievable MSE. | https://arxiv.org/abs/2106.02782 | Fetched (abstract), 2026-11-02 | J4 |
| R28 | Delétang et al. (2024). *Language Modeling Is Compression.* ICLR 2024. Predictive models ↔ lossless compressors; Chinchilla 70B compresses ImageNet patches to 43.4 % and LibriSpeech to 16.4 %. | https://arxiv.org/abs/2309.10668 | Search-observed, 2026-11-02 | J4 |
| R29 | Wyner, A. D., Ziv, J. (1976). The rate-distortion function for source coding with side information at the decoder. *IEEE Trans. Information Theory* 22(1), 1–10. | — | From memory | J4 |
| R30 | Quine, W. V. O. (1951). Two Dogmas of Empiricism. *Philosophical Review* 60(1), 20–43. | — | From memory | J5 |
| R31 | Quine, W. V. O., Ullian, J. S. (1970; 2nd ed. 1978). *The Web of Belief.* Random House. (Virtues: conservatism, modesty, simplicity, generality, refutability, precision.) | — | From memory | J5 |
| R32 | Quine, W. V. O. (1991). Two Dogmas in Retrospect. *Canadian Journal of Philosophy* 21(3), 265–274. Regrets the "needlessly strong statement of holism". | https://www.jstor.org/stable/40231747 | Search-observed, 2026-11-02; volume/pages from memory | J5 |
| R33 | Duhem, P. (1906). *La Théorie physique: son objet, sa structure* (Eng. *The Aim and Structure of Physical Theory*, 1954). | — | From memory | J5 |
| R34 | Anscombe, G. E. M. (1957). *Intention.* Blackwell. §32, shopping-list example (direction of fit). | — | From memory | J5 |
| R35 | Beer, S. (1972; 2nd ed. 1981). *Brain of the Firm.* Wiley. | — | From memory | J5 |
| R36 | Beer, S. (1979). *The Heart of Enterprise.* Wiley. (Variety attenuation/amplification, System 3*, algedonic channel.) | — | From memory | J5 |
| R37 | Ashby, W. R. (1956). *An Introduction to Cybernetics.* Chapman & Hall. (Law of requisite variety.) | — | From memory | J5 |
| R38 | Conant, R. C., Ashby, W. R. (1970). Every good regulator of a system must be a model of that system. *International Journal of Systems Science* 1(2), 89–97. | https://www.tandfonline.com/doi/abs/10.1080/00207727008920220 | Search-observed, 2026-11-02; pages from memory | J5 |
| R39 | Lässig, D. (2026-04-20). *Cybernetics and the "human-on-the-loop" in agentic coding.* Thoughtworks. Requisite variety, attenuation/amplification, Conant–Ashby, harness engineering, Gemba applied to agentic SDLC. | https://www.thoughtworks.com/insights/blog/generative-ai/cybernetics-and-human-on-the-loop-in-agentic-coding | Fetched (first ~60 %), 2026-11-02 | J5 |
| R40 | Parnas, D. L. (1972). On the criteria to be used in decomposing systems into modules. *CACM* 15(12), 1053–1058. | — | From memory | J5 |
| R41 | Tversky, A., Kahneman, D. (1974). Judgment under Uncertainty: Heuristics and Biases. *Science* 185(4157), 1124–1131. (Anchoring.) | — | From memory | J5 |
| R42 | Dhanorkar, Passi, Vorvoreanu (2026). *Human oversight of agentic systems in practice.* arXiv 2606.05391. 17 developer interviews; oversight forms: a priori control, co-planning, real-time monitoring, post hoc review; heuristic: test results used as guarantees of correctness. | https://arxiv.org/abs/2606.05391 | Fetched (abstract), 2026-11-02 | J5 |
| R43 | Fakhoury, Naik, Sakkas, Chakraborty, Lahiri (2024). *LLM-Based Test-Driven Interactive Code Generation: User Study and Empirical Evaluation* (TiCoder). IEEE TSE 50(9), 2254–2268. 15 programmers: more often correctly evaluated generated code, significantly lower task-induced cognitive load; +45.97 % absolute pass@1 within 5 interactions (idealised proxy user). | https://arxiv.org/abs/2404.10100 | Fetched (abstract), 2026-11-02 | J6 |
| R44 | Lahiri, S. K. (2026). *Intent Formalization: A Grand Challenge for Reliable Coding in the Age of AI Agents.* arXiv 2603.17150. Specification validation is the central bottleneck; the user is the only oracle for specification correctness. | https://arxiv.org/abs/2603.17150 | Fetched (abstract), 2026-11-02 | J6 |
| R45 | Böckeler, B. (2025-10-15). *Understanding Spec-Driven-Development: Kiro, spec-kit, and Tessl.* martinfowler.com. Verbose spec review ("I'd rather review code"), small bug → 4 user stories / 16 acceptance criteria, agent treated descriptions of existing classes as new specification. | https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html | Fetched, 2026-11-02 | J6, J7 |
| R46 | Petrović, Ivanković, Fraser, Just (2021). *Practical Mutation Testing at Scale: A view from Google.* IEEE TSE. Diff-scoped mutants during code review, filtered, capped per line and per review, selected by historical operator performance; >24,000 developers. | https://arxiv.org/abs/2102.11378 | Fetched (abstract), 2026-11-02 | J6 |
| R47 | Goodenough, J. B., Weinstock, C., Klein, A. Z. (2015). *Eliminative Argumentation: A Basis for Arguing Confidence in System Properties.* CMU/SEI technical report. | https://www.sei.cmu.edu/library/eliminative-argumentation-a-basis-for-arguing-confidence-in-system-properties/ | Search-observed, 2026-11-02 | J6 |
| R48 | Doyle, J. (1979). A truth maintenance system. *Artificial Intelligence* 12(3), 231–272. | — | From memory | J6 |
| R49 | Ghoniem, M., Fekete, J.-D., Castagliola, P. (2004). A Comparison of the Readability of Graphs Using Node-Link and Matrix-Based Representations. IEEE InfoVis 2004. | https://www.researchgate.net/publication/221005943 | Search-observed (title/venue); finding cited from memory | J6 |
| R50 | UK National Protective Security Authority. *Threat Image Projection (TIP) Guidance.* TIP superimposes fictional threat images in X-ray screening to measure and sustain screener detection performance. | https://www.npsa.gov.uk/system/files/documents/cc/6c/Threat-image-projection-TIP-guidance.pdf | Search-observed, 2026-11-02 | J7 |

## Local artifacts

| ID | Artifact | Observation | Used in |
|---|---|---|---|
| L1 | Installed skill `constructive-test-taxonomy` (`nix/pkg/llm-skills/skills/constructive-test-taxonomy/`) | Read 2026-11-02: records test *Origin* (Specified/Regression) as provenance metadata; says Origin matters only for auditing and gap analysis. | J2, J6 |
| L2 | Ponygirls `AGENTS.md`, section "Chronicle validation" | Read 2026-11-02 (session context): "do not shorten deadlines, skip cases, filter counters, or relax browser interactions to obtain a pass" — applies to all tests, regardless of provenance. | J2 |
| L3 | Pi extension documentation (`docs/extensions.md` of the installed pi-coding-agent 1.4.0) | Read 2026-11-02: `tool_call` handlers can mutate input or block execution; a handler failure blocks the tool (fail-safe). | J6 |
| L4 | Ponygirls `README.md` | Read 2026-11-02: Chronicle is described as a searchable archive of harness sessions; capabilities beyond that not inspected. | J6 |
