# UI workflow alignment

The original application is the reference for navigation and operator workflow,
not for implementation architecture or pixel-perfect styling.

| Operator task | Original workflow | Rewrite target |
| --- | --- | --- |
| Choose a server | Worlds fleet list | Worlds fleet list |
| Start or stop quickly | Controls on the world row | Controls on the world row |
| Manage one server | Open a dedicated world page | Open a dedicated world workspace |
| Check health | World header and Overview | World header, quick statistics, Overview |
| Work with players | Players tab | Players tab |
| Read output | Console tab | Console tab |
| Change game settings | Settings tab | Settings tab with structured and raw modes |
| Back up or restore | Backups tab | Backups tab |
| Automate operations | Schedule tab | Schedule tab |
| Change manager/launch settings | Admin tab | Admin tab |
| Follow installs and updates | Downloads navigation/page | Operations navigation/page |

Core rules:

- Fleet cards stay scannable. Secondary management actions belong inside a
  selected world's workspace.
- A selected world keeps its identity, status, primary lifecycle actions, and
  quick statistics visible while moving between tabs.
- Tabs use the familiar original ordering for capabilities that exist in the
  core release. Deferred integrations are omitted rather than shown as working.
- New implementation details such as jobs and SSE may improve feedback without
  changing the operator's mental model.
