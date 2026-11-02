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
| R4 | Anthropic Alignment Science (2025). *Reasoning models don't always say what they think* (paper: arXiv 2505.05410, search-observed). Hint mention 25 % (Claude 3.7 Sonnet) / 39 % (R1); trained reward hacks exploited >99 %, verbalised <2 %. | https://www.anthropic.com/research/reasoning-models-dont-say-think | Fetched (blog), 2026-11-02 | J1 |
| R5 | Shen, Tamkin (2026). *How AI Impacts Skill Formation* / Anthropic blog *How AI assistance impacts the formation of coding skills*. RCT n=52, mostly junior, Trio library; quiz 50 % vs 67 % (d=0.738, p=0.01), largest gap on debugging; speed-up not significant. | https://www.anthropic.com/research/AI-assistance-coding-skills ; https://arxiv.org/abs/2601.20245 | Fetched (blog), 2026-11-02; arXiv search-observed | J1 |
| R6 | Hong et al. (2025). *Context Rot: How Increasing Input Tokens Impacts LLM Performance.* Chroma technical report. | https://www.trychroma.com/research/context-rot | Search-observed, 2026-11-02 | J1 |
| R7 | Kim, Garg, Peng, Garg (2025). *Correlated Errors in Large Language Models.* ICML 2025. >350 LLMs; models agree 60 % of the time when both err (one leaderboard). | https://arxiv.org/abs/2506.07962 | Search-observed (abstract snippet), 2026-11-02 | J1 |
| R8 | Von Arx, Chan, Barnes (2025). *Recent Frontier Models Are Reward Hacking.* METR. Modifying tests/scoring code, accessing reference answers. | https://metr.org/blog/2025-06-05-recent-reward-hacking/ | Search-observed, 2026-11-02 | J1, J2 |
| R9 | Konstantinou, Degiovanni, Papadakis (2024/2026). *Do LLMs generate test oracles that capture the actual or the expected program behaviour?* (v2 title: *Can we find bugs using LLM-generated oracles?*, JACM). 24 Java repositories; LLM oracles mainly capture actual behaviour. | https://arxiv.org/abs/2410.21136 | Fetched (abstract v2), 2026-11-02 | J2 |
| R10 | Anthropic. *Prompting best practices*, section "Avoid focusing on passing tests and hardcoding": "Tests are there to verify correctness, not to define the solution … if any of the tests are incorrect, please inform me rather than working around them." | https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices | Fetched (markdown), 2026-11-02 | J2 |
| R11 | Panickssery, Bowman, Feng (2024). *LLM Evaluators Recognize and Favor Their Own Generations.* NeurIPS 2024. | https://arxiv.org/abs/2404.13076 | Search-observed (abstract), 2026-11-02 | J2 |
| R12 | Feng, Afroz, Sarma (2025). *From Gains to Strains: Modeling Developer Burnout with GenAI Adoption.* 442 developers, JD–R model, PLS-SEM; GenAI adoption raises burnout via job demands; resources and positive perceptions mitigate. | https://arxiv.org/abs/2510.07435 | Fetched (abstract), 2026-11-02 | J2 |
| R13 | Naur, P. (1985). Programming as Theory Building. *Microprocessing and Microprogramming* 15(5), 253–261. | — | From memory | J1 |
| R14 | Polanyi, M. (1966). *The Tacit Dimension.* "We can know more than we can tell." | — | From memory | J1 |
| R15 | Knight, J. C., Leveson, N. G. (1986). An experimental evaluation of the assumption of independence in multiversion programming. *IEEE TSE* SE-12(1), 96–109. | — | From memory | J1 |
| R16 | Kahneman, D., Klein, G. (2009). Conditions for intuitive expertise: a failure to disagree. *American Psychologist* 64(6), 515–526. | — | From memory | J1 |
| R17 | Chase, W. G., Simon, H. A. (1973). Perception in chess. *Cognitive Psychology* 4(1), 55–81. | — | From memory | J1 |
| R18 | Cowan, N. (2001). The magical number 4 in short-term memory. *Behavioral and Brain Sciences* 24(1), 87–114. | — | From memory | J1 |
| R19 | Johnson, M. K., Hashtroudi, S., Lindsay, D. S. (1993). Source monitoring. *Psychological Bulletin* 114(1), 3–28. | — | From memory | J1 |
| R20 | Bainbridge, L. (1983). Ironies of automation. *Automatica* 19(6), 775–779. | — | From memory | J1 |
| R21 | Sharma, M. et al. (2023). Towards Understanding Sycophancy in Language Models. arXiv 2310.13548. | — | From memory | J1 |
| R22 | Feathers, M. (2004). *Working Effectively with Legacy Code.* Prentice Hall. (Characterization tests.) | — | From memory | J2 |
| R23 | Barr, E. T., Harman, M., McMinn, P., Shahbaz, M., Yoo, S. (2015). The Oracle Problem in Software Testing: A Survey. *IEEE TSE* 41(5), 507–525. | — | From memory | J2 |
| R24 | Demerouti, E., Bakker, A. B., Nachreiner, F., Schaufeli, W. B. (2001). The job demands–resources model of burnout. *Journal of Applied Psychology* 86(3), 499–512. | — | From memory | J2 |
| R25 | Hart, S. G., Staveland, L. E. (1988). Development of NASA-TLX. In *Human Mental Workload*, North-Holland. | — | From memory | H-T4 |

## Local artifacts

| ID | Artifact | Observation | Used in |
|---|---|---|---|
| L1 | Installed skill `constructive-test-taxonomy` (`nix/pkg/llm-skills/skills/constructive-test-taxonomy/`) | Read 2026-11-02: records test *Origin* (Specified/Regression) as provenance metadata; says Origin matters only for auditing and gap analysis. | J2 |
| L2 | Ponygirls `AGENTS.md`, section "Chronicle validation" | Read 2026-11-02 (session context): "do not shorten deadlines, skip cases, filter counters, or relax browser interactions to obtain a pass" — applies to all tests, regardless of provenance. | J2 |
