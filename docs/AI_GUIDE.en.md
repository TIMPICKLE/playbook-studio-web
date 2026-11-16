# AI feature guide

[简体中文](AI_GUIDE.md) · **English** · [Back to README](../README.en.md)

Playbook Studio has two AI entry points. The board assistant edits and operates the editor. Matchup analysis uses diagrams and coaching references to discuss conditional situations. Both concern **American football**, but their settings, inputs and execution differ.

This guide describes the current repository implementation. The version available online depends on the actual deployment.

## Choose the entry point

| Your goal | Where to open it | API key required? |
|---|---|---|
| Add defense, edit routes, manage plays, control rehearsal or export | Workspace → **Edit playbook** → **AI** beside the field | Yes, to send assistant instructions |
| Inspect diagram facts and retrieved coaching references | Workspace → **AI matchup analysis** | No |
| Generate conditional offense-versus-defense scenarios | The same analysis page → model settings → **Analyze matchup** | Yes |

Start with the [no-sign-in demo](https://timpickle.github.io/playbook-studio-web/), which uses browser-local data and sample matchups. Use the [cloud editor](https://playbook-studio-tim.kind-wolf-6204.chatgpt.site/editor/) for shared team playbooks.

## 5v5 flag football and AI

Create a **5v5 flag football** play first, or ask the assistant to “Create a five-player flag Trips offense.” Then request “Add five opponents, keeping the offense” or “Have center C run a receiving route.” The assistant, diagram brief and model analysis receive the explicit flag format. The center is not assumed to be a blocking lineman, and eleven-player protection, tackling or contact coaching is not treated as flag rules.

Flag analysis currently excludes the built-in eleven-player coaching corpus that has not been adapted. Import your own flag knowledge pack to supplement diagram analysis. Supply event-specific rush, QB-running and field-distance rules; matching a flag play against an eleven-player formation produces a format warning.

An explicit **4–3 defense** request still creates the complete eleven players. Madden remains an eleven-player source. Changing the default count does not convert existing plays. See the [flag workflow](USER_GUIDE.en.md#5v5-flag-football).

## Connect a model

Both AI entry points use the same provider and API-format settings in cloud and no-sign-in versions: **choose the provider, choose the API format, then enter the model ID and API key**. Preset providers do not require a URL.

| Provider | Available API formats |
|---|---|
| DeepSeek | OpenAI Chat Completions, Anthropic Messages |
| Anthropic / Claude | Anthropic Messages |
| OpenAI | OpenAI Chat Completions, OpenAI Responses |
| OpenRouter | OpenAI Chat Completions, OpenAI Responses |
| Custom compatible service | All three formats; enter a custom HTTPS address |

The board assistant and cloud matchup analysis call tools. Choose a model that **supports tool calls through the selected API format**. No-sign-in matchup analysis remains a single request, but still requires the requested structured analysis result. Protocol support does not establish that every provider model supports that format or the required capabilities.

### Entering a custom address

Enter an HTTPS base URL or paste a complete endpoint. The application retains the existing path prefix and only appends or replaces the final protocol suffix:

| API format | Custom-address suffix | With base `https://gateway.example/team/v1` |
|---|---|---|
| OpenAI Chat Completions | `/chat/completions` | `https://gateway.example/team/v1/chat/completions` |
| Anthropic Messages | `/messages` | `https://gateway.example/team/v1/messages` |
| OpenAI Responses | `/responses` | `https://gateway.example/team/v1/responses` |

For example, paste the full Chat Completions endpoint above, then choose Messages: the endpoint becomes `/team/v1/messages` under the same host. The application **does not add `/v1` automatically**. Include `/v1`, `/api` or another gateway prefix if your service requires it. URLs must not contain credentials, query parameters or fragments; use the standard HTTPS port.

The no-sign-in version calls providers, including custom services, from the browser. The service must allow browser cross-origin requests (CORS). Cloud calls go through the server; an administrator must first allow a custom host, and local or internal addresses are unavailable. A selectable configuration does not establish browser connectivity or cloud host authorization.

Some services use the name “Claude Code Messages.” Here this means the **Anthropic Messages API format**, not a Claude Code login, subscription account or local CLI. Use the API service's endpoint, model ID and key.

### Switching formats and credentials

Changing API format within one provider retains the model ID, key and custom address; the actual endpoint is resolved for the new format when sending. Switching providers selects the new provider's default model and format, and clears the key and custom address to avoid reusing another provider's credentials.

Settings remain in current page memory. Re-enter the key after refreshing; requests consume your selected provider's credits. The application handles stateless OpenAI Responses history and tool results. You do not need to manage `response_id` or provide a previous response ID.

## Board assistant: from instruction to result

1. Open the play you want to work on and select **AI**. Type an instruction, or dictate it if the browser supports speech recognition. Review dictated text before sending.
2. Describe the goal, such as “Add a complete 4-3 defense to this Mesh diagram while retaining the offense and its routes.” You do not need internal IDs or manually placed new players.
3. Inspect the response. Data edits show a diagram preview or change list; view and rehearsal controls report the executed state; file workflows show **Continue**.
4. For data edits, rehearse the preview when available, then **Apply** or **Discard**. An applied group can be undone together.
5. If relevant objects, personnel or formations change while the proposal is pending, regenerate or inspect the refreshed preview before applying.

The edit and Madden search examples express a preference, not a capability switch. You can search offensive catalog plays while viewing a defensive diagram. Actual permissions and device conditions still apply.

### Instructions to try

| Goal | Example instruction | What to inspect |
|---|---|---|
| Add defense | “Add a complete 4-3 defense and retain the offense.” | Eleven new defenders; existing offense and routes retained |
| Reset defense | “Reset the existing defense to 4-3.” | Explicit replacement, old defensive routes removed and stale references repaired |
| Add and style a marker | “Add a blue square LB.” | Position, label, color and shape |
| Move a player | “Move the left X three yards outside.” | The intended marker and its attached routes |
| Change a route | “Have the left wide receiver run a 12-yard post.” | Intended player, actual depth, inside break and any field-boundary adjustment |
| Ordered blocks | “Have C block the DT directly ahead, then the LB named Alex.” | Two real targets and their contact order; clarification if ambiguous |
| Group blocks | “Have the OL zone block left.” | Actual participating players, targets and paths |
| Motion followed by a route | “Have Z jet left, then run a flat.” | Motion endpoint, following-route start and timing |
| Pass and timing | “Throw to Y at 2.5 seconds, arriving at 3.5.” | Ball carrier, receiver and times |
| Zones and notes | “Draw a left deep third.” “Label outside release beside X.” | Zone geometry and label; annotation text |
| Play details and geometry | “Rename this play Red Mesh and mirror it.” | Title and all affected mirrored objects |
| Playbook and personnel | “Duplicate this play.” “Save this formation.” “Apply an existing starter group.” | New play, template name or actual matched roster assignments |
| View and layout | “Use a light field and hide yard lines.” “Expand the board and zoom to 150%.” | Device-local view changes, not changed diagram coordinates |
| Rehearsal and history | “Loop rehearsal at half speed.” “Pause at two seconds.” “Undo the last edit.” | Playback, timeline, speed or an existing history checkpoint |
| Navigation and filtering | “Switch to the defense playbook.” “Filter for Mesh.” “Open properties.” | Play list, active diagram and panel |
| Catalog search and import | “Find Madden concepts against Cover 3.” | Actual catalog candidates, editability and conditional recommendations |
| Files and printing | “Export SVG.” “Print this play as a wristband.” “Import a local playbook.” | **Continue**, followed by the real browser workflow |

Identify players by role, name, number or relative alignment: `X`, `#12`, `Alex`, or “the left wide receiver.” Add side or name when several markers match. The assistant can use temporary references for newly created objects in the same group; you do not need to copy internal IDs.

### What adding a 4-3 means

The operation adds **four defensive linemen, three linebackers and four defensive backs**: eleven defenders. A seven-player workspace setting does not truncate this group while still calling it a 4-3. If defenders already exist, the assistant refuses to stack another group; explicitly request a reset to replace them.

A 4-3 describes personnel and starting alignment. **It does not automatically assign Cover 2, Cover 3 or matching rules.** Add coverage responsibilities separately. Adding defense retains the offense. Replacing the entire starting formation is a different operation that clears current routes, zones and annotations; inspect its change list before applying.

### When changes take effect

| Result | When it takes effect | Undo and next steps |
|---|---|---|
| Diagram objects, details, formations and related edits | After **Apply** | One edit-history checkpoint for the group |
| Create, duplicate or delete plays; save a formation | After reviewing the change list and selecting **Apply** | Undo the group; retain at least one play |
| View, layout, navigation and rehearsal controls | When the host finishes the action | Actual state is returned; display preferences do not modify play data |
| Files, printing and dialogs requiring further input | **Continue** opens the workflow | Select the file, confirm import or finish printing there |

`awaiting_user` means a workflow is prepared or waiting for input. It does not mean a file has been imported, a download saved, or a page printed. Check browser downloads after export starts. Opening the print panel still requires printing. For “edit, then export,” apply the edit before sending the export instruction.

A pending preview does not save the play. The assistant's dedicated undo can expire after other edits; use the editor's undo/redo history then. The current play retains five recent structured context entries. Do not rely on that conversation to identify objects after refreshing or switching plays.

### Progress checks and process details

The board assistant no longer stops at **six model requests or ten tool calls**, and it has no 90-second total task deadline. Useful queries can continue. After three consecutive rounds without new valid information, it asks the model to conclude from the evidence or clarify. Each model HTTP request and response read still has a 90-second timeout. You can cancel at any time.

Expand **View process** to inspect reads, resolution, previews, summaries and validation errors. This is not a display of model-internal reasoning. When the assistant repeats a lookup, selects the wrong person or finds no new material, a more specific target is usually more useful than resending the same sentence.

## Matchup analysis: facts before scenarios

### What works without a key

Open **AI matchup analysis** and select an offense and defense from the same playbook. The no-sign-in demo provides samples. Diagram facts and actually retrieved references are already available. These are local calculations and retrieval, **not a model-generated report**.

The brief describes visible markers, paths and zones. Drawn blocking lines do not establish a real protection count. A route intersecting a zone does not establish simultaneous arrival.

### Generate an analysis

1. Select offense and defense. Mirror defense to align the diagrams when needed, or choose a player's perspective. Analysis mirroring does not change the original play.
2. Set the coverage assumption: **unknown, Cover 3 spot, Cover 3 Match, variant-unconfirmed Cover 2, Cover 2 Read, or man**. Keep unknown when only safety alignment is visible. Generic Cover 2 is not Cover 2 Read.
3. Add down, distance, field position, confirmed protection or matching rules, and a specific question. Choose real-football or Madden diagram context; a Madden drawing does not establish game-engine behavior.
4. Inspect reference conditions, exceptions, read keys and original sources. Import team material or narrow the reference query when needed.
5. Enter model settings and start the analysis. Use cancel to stop.
6. Read each scenario as an “if”: inspect its observation, possibility, suggested action and missing information. Diagram evidence highlights actual objects; knowledge evidence opens source details.

For example: “Third-and-six, confirmed Cover 3 spot. From Y's perspective on Mesh, who should be observed? Separate visible diagram facts from unconfirmed team rules.” If coverage is not confirmed, describe it as unknown instead.

Changing the plays, coverage, context or knowledge invalidates the old report and cancels related pending requests. An old report is not a conclusion about a newly selected matchup.

### Cloud and no-sign-in analysis

| Item | Cloud analysis | No-sign-in analysis demo |
|---|---|---|
| Data | A playbook the current member can read | Browser demo data and sample plays |
| Model flow | Read-only tools inspect context, rules and authorized references | One model request after local retrieval |
| Providers and API formats | The same five provider choices and three formats as the board assistant, listed above | The same choices; direct browser calls depend on the network and CORS |
| References and citations | Only the selected authorized excerpts; citation IDs checked | Shared geometry and citation-ID checks; analysis remains limited |

Removal of the six/ten quota applies to the **board assistant**. Separate cloud matchup analysis still has a per-run budget of at most four model requests and a 90-second total timeout. Cloud AI requests may also encounter short-term frequency protection, and providers impose their own credit or rate limits. These are different from the removed board-assistant query quota.

## Import team knowledge

Use the references area of **AI matchup analysis**. Imported packs support matchup analysis; they do not become long-term memory for the board assistant or make reference images editable.

| File | Current handling |
|---|---|
| Markdown / TXT | Text cards created from headings and paragraphs, splitting long passages; coverage and rules are not automatically certified |
| JSON | A validated project knowledge pack, preserving sources, conditions, exceptions, pages, regions and explicit figure associations |
| Selectable-text PDF | Generate JSON with the [local preprocessing tool](ai-analysis/pdf-ingestion.md), then import it |
| Scanned PDF, photo or diagram-only page | Separate OCR or manual description is needed; automatic visual football-diagram understanding is not implemented |

You can structure a simple `.md` file like this:

```markdown
# Cover 3 spot: confirmed team rules

Applies when: describe the confirmed coverage and offensive concept.

Read key: describe the player or area this position should actually observe.

Exceptions: state the adjustments under which this rule should not be used.
```

Check position labels, negation, read order and numbers before import. For machine-filterable coverage, conditions and figure links, use reviewed structured JSON; see the [knowledge architecture](ai-analysis/knowledge-architecture.md).

Each import is limited to **1,000,000 bytes and 400 cards**. A retrieval uses at most **six excerpts / 24,000 UTF-8 bytes**, rather than sending the complete library. Imports merge and deduplicate. Remove sources or export a JSON backup from the references area.

Knowledge is stored for the **current device, browser and playbook**. It does not sync with cloud playbooks. Export and import it on another device to share it with a teammate. If browser storage is unavailable, an error is shown; that is not a successful save.

Pages and figure regions preserve provenance. **Being on the same page does not establish an association.** Only explicit links connect text and figures. PDF preview PNGs support manual review and are not imported with the JSON or automatically sent to a model. Automatic OCR, image understanding, vector search, reranking and shared cloud knowledge storage are not implemented.

## Interpreting evidence and limitations

- Diagram evidence identifies real objects; knowledge evidence locates a source. Valid citation IDs do not prove source reliability or a model conclusion.
- The 13 built-in bilingual principles have conditions and exceptions. They are not a complete team install; dedicated run-game and Four Verticals material remains incomplete. Missing references lead to limited analysis.
- Static alignment does not prove defensive responsibility, protection assignment, simultaneous arrival or actual read order. Team rules or a coach must supply unknowns.
- Analysis does not predict win probability, EPA, yardage or guaranteed success. Editable paths are schematic geometry, and rehearsal timing needs review.
- Scripted-model tests verify tools, previews and host workflows. They do not establish that every real model will correctly interpret every instruction.

## What is sent to the provider

| Entry point | Possible request data |
|---|---|
| Board assistant | Current diagram and notes, player names or numbers, and tool-read outlines of plays, roster, formations and personnel groups used to identify and edit objects |
| Separate matchup analysis | Selected offensive and defensive diagram objects, coverage assumptions, game context and selected reference excerpts; complete roster, player names, image pixels and coach notes are excluded by default |
| Opt-in coach notes in analysis | Up to the first 3,000 characters per play in cloud analysis, or 2,000 per play in the no-sign-in demo |

Keys remain in current page memory. The no-sign-in version requests the provider from the browser; the cloud version calls from the server, which receives model configuration and the key for that request. Do not paste keys into instructions or knowledge documents.

## Troubleshooting

| Situation | What to do |
|---|---|
| The assistant still says it cannot add 4-3 defense | Check that the updated version has been deployed and select an editable play. Explicitly request a reset if defenders exist; no Madden defensive catalog entry is required |
| A player is missing or the wrong repeated role is selected | Add offensive/defensive side, left/right, name or number. Check the actual marker in the preview |
| The play is only a source image | Use a reconstructed editable entry or the existing conversion workflow. Opening conversion does not mean all images have been recognized |
| Applying says the play has changed | Relevant objects, personnel or formations changed. Regenerate and inspect the preview |
| No references match | Check concept terms, coverage assumptions and query words, or import relevant material. Missing references must not be fabricated |
| A teammate cannot see imported knowledge | Packs are local to a browser and playbook. Export the pack for the teammate to import on their device |
| Incompatible format, or HTTP 400 / 404 | Check model support for the chosen format, the address prefix and final endpoint. Custom gateways do not gain `/v1` automatically. Messages is not a Claude Code login |
| Network or CORS error | Direct browser calls require provider CORS support; cloud custom hosts require administrator authorization. Check connectivity rather than assuming a selectable configuration is reachable |
| HTTP 401 / 403 | Check the provider, model permission and matching API key; check the allowlist for a cloud custom host |
| Timeout or HTTP 429 | Check provider credit, rate limits and cloud short-term frequency protection; retry later. These differ from the removed assistant query quota |
| Refusal, truncated output or invalid result format | Empty or incomplete output is not a completed action. Check tool and output support; use a compatible model or simplify the individual request if necessary |
| Digital mode is unavailable on a phone or iPad | Those devices use traditional mode; editing and rehearsal remain available |
| A file or print task says it is ready but has not finished | Select **Continue**, then complete file selection, import confirmation or printing in the real workflow |

## Further reading

- [Board tool flow and maintenance](BOARD_ASSISTANT.md) · [Shared commands and full feature mapping](EDITOR_COMMAND_ARCHITECTURE.md)
- [Analysis research and evaluation](ai-analysis/README.md) · [Local PDF preprocessing](ai-analysis/pdf-ingestion.md)
- [Multimodal knowledge design](ai-analysis/knowledge-architecture.md) · [Real-model evaluation cases](../evals/board-assistant/README.md)

The engineering documents above are currently in Chinese.
