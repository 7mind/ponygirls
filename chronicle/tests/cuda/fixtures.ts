export interface Topic {
  id: string;
  document: string;
  answer: string;
  query: string;
}

export const topics: readonly Topic[] = [
  { id: 'database', document: 'PostgreSQL transaction isolation prevents concurrent transactions from observing uncommitted writes. Serializable isolation detects conflicting schedules and applications must retry serialization failures.', answer: 'Use explicit transactions for the bank transfer. Commit both account balance updates atomically; retry the entire transaction after a serialization failure.', query: 'How should concurrent bank transfers avoid inconsistent account balances?' },
  { id: 'astronomy', document: 'A lunar eclipse occurs when Earth moves between the Sun and Moon. Earth casts its shadow onto the lunar surface during the full moon. The atmosphere scatters blue light, leaving a copper red moon. 🌕', answer: 'A lunar eclipse is safe to observe without protective glasses. The red color comes from sunlight filtered through the terrestrial atmosphere.', query: 'Why does our natural satellite turn reddish when our planet blocks sunlight?' },
  { id: 'baking', document: 'Sourdough bread rises through fermentation by wild yeast and lactic acid bacteria. A flour and water starter produces carbon dioxide, which gluten traps in the dough.', answer: 'Feed the sourdough starter regularly and allow sufficient proofing time before baking. Strong gluten and an active starter create an airy loaf.', query: 'What makes a naturally fermented loaf develop an airy crumb?' },
  { id: 'network', document: 'TLS certificate validation authenticates the remote server. The client verifies the certificate hostname, expiration date and chain of trust before exchanging application data.', answer: 'When an HTTPS certificate expires, renew it and configure the server with the new chain. Never disable client certificate verification to suppress the expiration error.', query: 'What is the safe fix when an encrypted web connection rejects an expired server identity?' },
  { id: 'gardening', document: 'Tomato plants need well drained soil and consistent watering at the roots. Mulch reduces evaporation. Excessive watering can cause root rot and fungal disease.', answer: 'Let the upper soil dry slightly between waterings. Keep tomato leaves dry and maintain drainage so the roots receive enough oxygen.', query: 'How can I stop vegetable roots rotting in waterlogged garden soil?' },
  { id: 'music', document: 'A violin has four strings tuned in perfect fifths: G, D, A and E. A bow drawn across the strings produces vibrations; changing finger positions changes the pitch.', answer: 'Tune the violin A string with a reference pitch, then tune the adjacent strings by fifths. Rosin on the bow hair helps it grip the strings.', query: 'How are the four strings of a bowed orchestral instrument tuned?' },
];

export const unrelatedQuery = 'Which customs declaration form is required to import a ceramic vase into Antarctica?';
