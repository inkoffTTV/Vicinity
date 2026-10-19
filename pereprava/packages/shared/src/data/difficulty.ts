// Сложность бота (как в прототипе 0.3): множители урона и здоровья его героя, порог отступления,
// агрессия (насколько он рискует в драке) и как часто думает.

export interface Difficulty {
  id: string;
  name: string;
  dmg: number;
  hp: number;
  aggr: number;
  retreat: number;
  think: number;
}

export const DIFFICULTIES: Record<string, Difficulty> = {
  easy: { id: 'easy', name: 'лёгкий', dmg: 0.75, hp: 0.9, aggr: 0, retreat: 0.45, think: 0.45 },
  normal: { id: 'normal', name: 'обычный', dmg: 1, hp: 1, aggr: 0.15, retreat: 0.3, think: 0.25 },
  hard: { id: 'hard', name: 'сложный', dmg: 1.15, hp: 1.15, aggr: 0.35, retreat: 0.22, think: 0.15 },
};

export const difficulty = (id: string | null | undefined): Difficulty => DIFFICULTIES[id ?? ''] ?? DIFFICULTIES.normal;
