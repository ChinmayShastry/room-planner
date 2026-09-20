/**
 * Editorial content shared between pages.
 *
 * Kept here so the same copy can feed both the rendered page and the
 * structured data in the document head, and so landing pages can pick the
 * sections that are actually relevant to them instead of repeating everything.
 */

export interface FaqItem {
  question: string;
  answer: string;
}

export const GENERAL_FAQ: FaqItem[] = [
  {
    question: 'Can I use the room planner for free?',
    answer:
      'Yes. Room Planner is free to use, with no account, no trial and no limit on how many rooms you plan.',
  },
  {
    question: 'Do I need to download anything?',
    answer:
      'No. The planner runs entirely in your web browser on desktop, tablet and phone. There is nothing to install.',
  },
  {
    question: 'Can I plan a bedroom?',
    answer:
      'Yes. Start from the bedroom template or enter your own dimensions, then add a bed, wardrobe, nightstands and a desk from the furniture library. Every item can be resized to match what you own.',
  },
  {
    question: 'Can I add my own furniture dimensions?',
    answer:
      'Yes. Select any item and type its exact width and depth into the panel on the right. You can also rename it, so "Sofa" can become "IKEA Kivik" if that helps you keep track.',
  },
  {
    question: 'Can I move furniture around?',
    answer:
      'Drag any item with a mouse, finger or stylus. You can also select an item and use the arrow keys, or type exact X and Y positions, which is often faster than dragging on a phone.',
  },
  {
    question: 'Can I save my room layout?',
    answer:
      'Yes. Your work is saved automatically in this browser, and you can also save named layouts to come back to. Because there is no account, layouts live on the device you created them on. Use Export layout file to move one to another device.',
  },
  {
    question: 'Does the room planner work on mobile?',
    answer:
      'Yes. On a phone the canvas fills the screen and the tools sit in a bottom bar. Furniture is touch-draggable, and numeric fields let you place things precisely without fiddly dragging.',
  },
  {
    question: 'Can I download my room plan?',
    answer:
      'You can download your plan as a PNG image or an SVG file, and export the layout itself as a JSON file that you can import again later.',
  },
  {
    question: 'Can I print my room plan?',
    answer:
      'Yes. Print Layout produces a clean black-and-white floor plan with dimensions and a legend. Sidebars, buttons and ads are hidden from the printout.',
  },
  {
    question: 'Are the measurements accurate?',
    answer:
      'The plan is exactly as accurate as the dimensions you enter. Room Planner does the arithmetic faithfully, but it cannot check your tape measure. Measure wall to wall, and always confirm critical dimensions before buying furniture or making building decisions.',
  },
];

export interface GuideSection {
  id: string;
  title: string;
  body: string[];
  /** Optional short list rendered as bullets under the body. */
  points?: string[];
}

export const GUIDE_SECTIONS: Record<string, GuideSection> = {
  whatIs: {
    id: 'what-is-a-room-planner',
    title: 'What is a room planner?',
    body: [
      'A room planner is a simple drawing of your room seen from above, with your furniture drawn to scale inside it. Instead of pushing a wardrobe across the floor to find out it does not fit, you move a rectangle on a screen.',
      'It answers the questions that matter before a delivery van arrives: will the bed fit under the window, can the door still open, and is there room to walk past the end of the sofa.',
    ],
  },
  howToPlace: {
    id: 'how-to-plan-furniture-placement',
    title: 'How to plan furniture placement',
    body: [
      'Start with the biggest thing in the room and the thing you cannot move. In a bedroom that is the bed and the door; in a living room it is the sofa and whatever the sofa is pointing at.',
    ],
    points: [
      'Place the largest item first, usually against the longest unbroken wall.',
      'Keep the path from the door to the window, and from the door to the bed, clear.',
      'Leave doors and wardrobes room to open fully — a door needs roughly its own width of floor.',
      'Group seating so people can talk without shouting: about 7 to 9 ft across a conversation.',
      'Only then add the small things. Nightstands, lamps and plants fill gaps; they should not create them.',
    ],
  },
  bedSpace: {
    id: 'space-around-a-bed',
    title: 'How much space should you leave around a bed?',
    body: [
      'As a planning guideline, aim for about 24 in (60 cm) along any side of the bed you need to walk down, and about 36 in (90 cm) where two people pass or where a wardrobe door swings open.',
      'At the foot of the bed, 24 in is workable and 36 in feels comfortable. If a chest of drawers faces the bed, measure from the open drawer, not the closed one.',
    ],
    points: [
      'One side against a wall is fine for a single bed or a child’s room.',
      'A double bed used by two people wants a walkway on both sides.',
      'Allow the wardrobe door’s full swing plus room to stand in front of it.',
    ],
  },
  smallBedroom: {
    id: 'arrange-a-small-bedroom',
    title: 'How to arrange furniture in a small bedroom',
    body: [
      'In a small bedroom, the win is usually giving up one walkway rather than shrinking the furniture. Pushing a single bed lengthways against a wall can free a metre of usable floor.',
    ],
    points: [
      'Put the bed in a corner if only one person uses it.',
      'Choose tall, narrow storage over wide, low storage — the floor is the scarce resource.',
      'Keep the area in front of the door clear so the room reads as bigger than it is.',
      'A wall-mounted or floating desk removes a table’s legs from the floor plan entirely.',
      'Check the wardrobe door swing before anything else: it is the most common thing that does not fit.',
    ],
  },
  livingRoom: {
    id: 'plan-a-living-room-layout',
    title: 'How to plan a living room layout',
    body: [
      'Decide what the room points at — a TV, a fireplace, or a window — and build the seating around that. Everything else follows from the answer.',
    ],
    points: [
      'Leave about 14 to 18 in between the sofa and the coffee table.',
      'Sit roughly 1.5 to 2.5 times the screen diagonal away from a TV.',
      'Keep at least 30 in for the main walking route through the room, 36 in where you can.',
      'A rug should sit under at least the front legs of the seating, not float in the middle.',
    ],
  },
  measuring: {
    id: 'how-to-measure-a-room',
    title: 'How to measure a room before buying furniture',
    body: [
      'Measure wall to wall at floor level, because skirting boards, radiators and bay windows all make a room narrower than it looks. Measure each wall separately: very few rooms are truly rectangular.',
    ],
    points: [
      'Write down width and length in the same unit, and note which is which.',
      'Measure the doorway width and any hallway or stair turn the furniture has to pass through.',
      'Note where windows, radiators and sockets are — they decide where a bed or desk can actually go.',
      'Measure ceiling height if you are considering a wardrobe, bunk bed or shelving unit.',
    ],
  },
  willItFit: {
    id: 'how-to-check-if-furniture-will-fit',
    title: 'How to check if furniture will fit',
    body: [
      'There are two separate questions, and people usually only ask the first one: does it fit in the room, and can it get into the room.',
      'A sofa that fits a living room perfectly is no use if it cannot turn the corner at the top of the stairs. For the doorway, what matters is the smallest face the item can be presented on — its height and depth, not its length.',
    ],
    points: [
      'Check the footprint against the room, including the space you need to use it.',
      'Check the narrowest opening on the route in: doorways, stair turns, and lift doors.',
      'Remember that feet, handles and packaging add an inch or two.',
      'Try the Will It Fit? calculator for a quick answer on both questions.',
    ],
  },
};

export const ALL_GUIDE_SECTIONS: GuideSection[] = [
  GUIDE_SECTIONS.whatIs!,
  GUIDE_SECTIONS.howToPlace!,
  GUIDE_SECTIONS.bedSpace!,
  GUIDE_SECTIONS.smallBedroom!,
  GUIDE_SECTIONS.livingRoom!,
  GUIDE_SECTIONS.measuring!,
  GUIDE_SECTIONS.willItFit!,
];

/** schema.org FAQPage block for the document head. */
export function faqSchema(items: FaqItem[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: { '@type': 'Answer', text: item.answer },
    })),
  };
}

/** schema.org WebApplication block, used on the tool pages. */
export function appSchema(name: string, description: string, url: string): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name,
    description,
    url,
    applicationCategory: 'DesignApplication',
    operatingSystem: 'Any browser',
    browserRequirements: 'Requires JavaScript',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  };
}
