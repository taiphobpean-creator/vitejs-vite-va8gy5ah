31 Scat V4 changes:
- Player states: ACTIVE / RECONNECTING / LEFT
- LEAVE button support
- 5-minute reconnect grace
- LEFT players remain in room history, totalChip and ledger
- LEFT players are excluded from future rounds
- If active player leaves mid-round, the round is VOID and restarts
- Host transfers automatically to next non-LEFT player

Replace server/index.ts and src/main.tsx.
Append src/styles.css to your existing CSS, or merge it into the bottom.
