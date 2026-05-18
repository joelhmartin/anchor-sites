Subject: [Builder] ✓ Phase {{phase_number}} complete — ready for Phase {{next_phase_number}}?

Phase {{phase_number}} ({{phase_name}}) is done.

**What was built:**
{{summary_bullets}}

**Demo URLs:**
{{demo_urls}}

**Test coverage:** {{test_count}} tests, {{test_pass_rate}}% passing (delta: {{test_delta}} new tests this phase)

**What Phase {{next_phase_number}} will do:** {{next_phase_preview}}

**To start Phase {{next_phase_number}}:** create the file `.routine/NEXT-PHASE-APPROVED` with any contents, commit, and push. I'll see it on the next routine run and expand the Phase {{next_phase_number}} task file.

**Or — if you want changes first:** reply with concerns. I'll wait.

—
Commit: {{commit_sha}}
Plan: {{plan_md_url}}
Phase {{phase_number}} file: {{phase_md_url}}
