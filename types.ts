
export interface Habit {
  id: string;
  name: string;
  activeDays?: number[] | null; // null/undefined = all month; number[] = specific days of month (1..31)
}


export type MonthlyHabits = Record<string, Habit[]>; // key: "YYYY-MM"

export type HabitLog = Record<string, Record<string, boolean>>; // { habitId: { "YYYY-MM-DD": boolean } }

export interface DayStats {
  date: string;
  dayOfMonth: number;
  dayOfWeek: string;
  completed: number;
  notCompleted: number;
  available: number;
  percentage: number;
}
