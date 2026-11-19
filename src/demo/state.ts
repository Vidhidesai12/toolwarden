/** Where the demo servers read their "rug pull" switch. Shared by servers.ts and rugpull.ts. */
export const STATE_FILE = process.env.DEMO_STATE ?? '.demo-state.json';
