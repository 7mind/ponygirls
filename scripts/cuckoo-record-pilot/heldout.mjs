export const HELD_OUT = [
  {
    id: 'h1', role: 'held-out', kind: 'work',
    objectives: {
      welcome: {
        key: /welcom|greeting|opening (?:announcement|remarks|address)|fair announcement/i,
        at: 0, fate: ['complete', 2],
        examples: ['Draft the fair welcome announcement', 'Fernwick fair opening remarks', 'Write a greeting to open the fair', 'Prepare the welcome for visitors'],
      },
      riddle: {
        key: /riddl|puzzl|clue|crown hunt|paper crown/i,
        at: 0, fate: ['retired', 1],
        examples: ['Write the paper crown riddle', 'Create a clue for the crown hunt', 'Draft a puzzle for finding the crown', 'Come up with a paper crown hunt hint'],
      },
      card: {
        key: /thank|appreciation|gratitude|seed[\s-]+swap (?:card|hosts?)|card for (?:the )?hosts/i,
        at: 0, fate: ['open'],
        examples: ['Draft a thank-you card for the hosts', 'Write an appreciation message for the seed swap', 'Prepare the seed swap card', 'Express gratitude to the volunteers'],
      },
    },
    rules: {
      punctuation: {
        key: /exclamation|bangs?\b|!/i,
        at: 0, examples: ['Avoid exclamation marks', 'No exclamation points in replies'],
      },
    },
    questions: /spore|seed (?:reproduction|propagation)/i,
    questionExamples: ['Explain how spores differ from seeds', 'Answer the seed versus spore question'],
    oneTurn: null, oneTurnExamples: [],
    turns: [
      'I need a short welcome announcement for the Fernwick fair, a riddle for the paper crown hunt, and a thank-you card for the seed swap hosts. Just sketch the welcome here for now and leave the other two for later. No exclamation marks anywhere in this chat, please.',
      'Drop the paper crown riddle entirely. Finish the welcome announcement now, and mention that the doors open at ten.',
      'The welcome announcement is approved as written. Quick question: how is a spore different from a seed?',
      "The seed swap hosts stayed late to pack up, so that's what the card should thank them for. Hold off on finishing the card until I settle on who signs it.",
    ],
    notes: 'After 1: welcome, riddle, and card active; punctuation rule in effect. After 2: riddle retired; welcome and card active. After 3: welcome complete; card active; no entry for the question. After 4: card still open. The rule stays in effect throughout.',
  },
  {
    id: 'h2', role: 'held-out', kind: 'work',
    objectives: {
      speech: {
        key: /curtain|speech|opening (?:remarks|address|welcome)|stage welcome/i,
        at: 0, fate: ['complete', 2],
        examples: ['Write the curtain speech', 'Opening remarks for the puppet show', 'Draft the stage welcome', 'Prepare an opening address for the audience'],
      },
      blurb: {
        key: /lost[\s-]+and[\s-]+found|lost\s*&\s*found|(?:lost|missing|misplaced) (?:items|property|belongings)|lobby blurb/i,
        at: 0, fate: ['retired', 1],
        examples: ['Draft the lost-and-found blurb', 'Write a notice about missing belongings', 'Explain where to claim lost property', 'Prepare the lobby blurb'],
      },
      invitation: {
        key: /invit|read[\s-]*through|script read|cast call/i,
        at: 1, fate: ['complete', 3],
        examples: ['Draft the cast invitation', 'Invite the performers to the read-through', 'Write the message for Saturday’s script reading', 'Prepare the read-through announcement for the cast'],
      },
    },
    rules: {
      clock: {
        key: /24[\s-]*hour|military time|hh:mm/i,
        at: 2, examples: ['Use 24-hour times', 'Format times using the 24-hour clock'],
      },
    },
    questions: null, questionExamples: [],
    oneTurn: null, oneTurnExamples: [],
    turns: [
      'For the puppet show, I need a short curtain speech to open the show and a lost-and-found blurb for the lobby. Just sketch the speech here for now and leave the blurb for later.',
      'Drop the lost-and-found blurb. I also need a short invitation to the cast read-through, but wait until I send you the time. Finish the curtain speech now with a nod to the puppeteers.',
      'I approve the curtain speech as written. From here on, use 24-hour times. Please finish the cast invitation now for Saturday at 6:30 p.m.',
      'The cast invitation is approved as written, thanks.',
    ],
    notes: 'After 1: speech and blurb active. After 2: blurb retired; speech and invitation active. After 3: speech complete; invitation active; clock rule added. After 4: invitation complete, no active objectives; clock rule remains.',
  },
  {
    id: 'h3', role: 'held-out', kind: 'single',
    objectives: {
      label: {
        key: /label|(?:museum|exhibit) (?:text|copy|sign(?:age)?)|placard|caption|backward[s-]* clock|clock that runs backward/i,
        at: 0, fate: ['complete', 3],
        examples: ['Draft a museum label for the backwards clock', 'Write the exhibit placard', 'Prepare two sentences of exhibit copy', 'Compose the caption for the clock display'],
      },
    },
    rules: {
      language: {
        key: /(?:plain|simple|everyday|clear) (?:language|word(?:ing|s)?|english)|jargon|keep (?:the wording|it) simple/i,
        at: 1, examples: ['Use plain language', 'Stick to everyday words and avoid jargon'],
      },
    },
    questions: null, questionExamples: [],
    oneTurn: null, oneTurnExamples: [],
    turns: [
      "I'm making up a museum exhibit about a clock that runs backward, and I need a two-sentence label for it. Start with just the opening phrase here; I'll give you the angle before you finish the label.",
      'Use plain language for the rest of this chat. For the opening, focus on what a visitor would see, not on who made the clock.',
      'Make the second sentence explain that the clock is meant to make time feel playful. Put the whole label together now.',
      'I approve the label exactly as written.',
    ],
    notes: 'After 1: label active. After 2: label still active; plain-language rule added. After 3: unchanged; the pieces and assembly are steps, not separate objectives. After 4: label complete; rule remains.',
  },
  {
    id: 'h4', role: 'held-out', kind: 'control',
    objectives: {},
    rules: {
      emoji: {
        key: /emoji|emoticon|smileys?/i,
        at: 1, examples: ['No emojis in this chat', 'Avoid emoji in all replies'],
      },
    },
    questions: /float|buoyan|cover(?:ing|ed)? (?:the |a )?mug|lid|keep(?:ing)? (?:the )?tea warm|heat retention/i,
    questionExamples: ['Explain why dried mint leaves float', 'Answer whether a lid keeps tea warm'],
    oneTurn: /caffeine[\s-]*free|minty (?:herbal )?tea|(?:substitut|synonym|alternativ|replacement).{0,30}steep|steep.{0,30}(?:substitut|synonym|alternativ|replacement)/i,
    oneTurnExamples: ['Suggest two caffeine-free minty teas', 'Give a synonym for steep'],
    turns: [
      'Why do dried mint leaves float when I first put them in water?',
      'No emojis in this chat, please. Does covering the mug keep the tea warm while it steeps?',
      'Give me two caffeine-free teas with a minty flavor.',
      "Give me a short substitute for the word 'steep' in a tea recipe.",
    ],
    notes: 'After 1: empty. After 2: only the emoji rule. After 3 and 4: unchanged; no objectives at any point.',
  },
];
