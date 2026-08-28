export type Suit =
  | "♠"
  | "♥"
  | "♦"
  | "♣";

export type Rank =
  | "A"
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "10"
  | "J"
  | "Q"
  | "K";

export type Card = {
  id: string;
  suit: Suit;
  rank: Rank;
  value: number;
};

const suits: Suit[] = [
  "♠",
  "♥",
  "♦",
  "♣"
];

const ranks: Rank[] = [
  "A",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K"
];

function getValue(rank: Rank) {
  if (rank === "A") return 11;

  if (
    rank === "J" ||
    rank === "Q" ||
    rank === "K"
  ) {
    return 10;
  }

  return Number(rank);
}

export function createDeck(): Card[] {
  const deck: Card[] = [];

  suits.forEach((suit) => {
    ranks.forEach((rank) => {
      deck.push({
        id: `${rank}-${suit}`,
        suit,
        rank,
        value: getValue(rank)
      });
    });
  });

  return deck;
}

export function shuffleDeck(cards: Card[]) {
  const deck = [...cards];

  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(
      Math.random() * (i + 1)
    );

    [deck[i], deck[j]] = [
      deck[j],
      deck[i]
    ];
  }

  return deck;
}

export function isThreeOfKind(
  hand: Card[]
) {
  if (hand.length !== 3) return false;

  return hand.every(
    (card) => card.rank === hand[0].rank
  );
}

export function calculateScore(
  hand: Card[],
  initialHand = false
) {
  if (isThreeOfKind(hand)) {
    return initialHand ? 31 : 30.5;
  }

  const totals: Record<Suit, number> = {
    "♠": 0,
    "♥": 0,
    "♦": 0,
    "♣": 0
  };

  hand.forEach((card) => {
    totals[card.suit] += card.value;
  });

  return Math.max(
    ...Object.values(totals)
  );
}

export function calculateSettlement(
  scores: {
    id: string;
    score: number;
  }[],
  multiplier: number
) {
  const result: Record<string, number> = {};

  scores.forEach((player) => {
    result[player.id] = 0;
  });

  for (let i = 0; i < scores.length; i++) {
    for (
      let j = i + 1;
      j < scores.length;
      j++
    ) {
      const a = scores[i];
      const b = scores[j];

      if (a.score === b.score) {
        continue;
      }

      const winner =
        a.score > b.score ? a : b;

      const loser =
        a.score > b.score ? b : a;

      const difference =
        winner.score - loser.score;

      // 31 ได้ Double
      const bonus =
        winner.score === 31 ? 2 : 1;

      const chips =
        difference *
        multiplier *
        bonus;

      result[winner.id] += chips;
      result[loser.id] -= chips;
    }
  }

  return result;
}