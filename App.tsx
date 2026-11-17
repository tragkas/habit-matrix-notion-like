import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts';
import {
  Plus,
  Trash2,
  Edit2,
  Check,
  Target,
  TrendingUp,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Download,
  Upload,
  Database,
  RotateCcw,
  AlertCircle,
  Loader2
} from 'lucide-react';
import { Habit, HabitLog, DayStats } from './types';
import { MONTHS } from './constants';
import { getDaysInMonth, getDayName, formatDateKey } from './utils';
import {
  getHabitsForMonth,
  addHabitToMonth,
  updateHabitName,
  updateHabitSchedule,
  deleteHabitFromMonth,
  getAllHabitLogs,
  toggleHabitDate,
  exportDatabaseFile,
  importDatabaseFile,
  resetDatabaseWithDefaults,
  subscribeToDatabaseChanges,
  getPersistenceError
} from './sqliteService';
import { GoalModal } from './GoalModal';

const isDayOpenForHabit = (habit: Habit, dayOfMonth: number): boolean => {
  if (!habit.activeDays) return true;
  return habit.activeDays.includes(dayOfMonth);
};

const App: React.FC = () => {
  const now = useMemo(() => new Date(), []);
  const [currentMonth, setCurrentMonth] = useState(now.getMonth());
  const [currentYear, setCurrentYear] = useState(now.getFullYear());
  const [isDbLoading, setIsDbLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dbStatus, setDbStatus] = useState<{ text: string; isError?: boolean } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const statusTimerRef = useRef<number | null>(null);
  const loadSeqRef = useRef(0);

  const showStatus = useCallback((text: string, isError = false, duration = 3500) => {
    if (statusTimerRef.current !== null) {
      window.clearTimeout(statusTimerRef.current);
    }
    setDbStatus({ text, isError });
    statusTimerRef.current = window.setTimeout(() => {
      setDbStatus(null);
      statusTimerRef.current = null;
    }, duration);
  }, []);

  useEffect(() => {
    return () => {
      if (statusTimerRef.current !== null) {
        window.clearTimeout(statusTimerRef.current);
      }
    };
  }, []);

  const monthKey = useMemo(() => {
    return `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
  }, [currentYear, currentMonth]);

  const [habits, setHabits] = useState<Habit[]>([]);
  const [logs, setLogs] = useState<HabitLog>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [isSavingGoal, setIsSavingGoal] = useState(false);
  const [goalModalState, setGoalModalState] = useState<{
    isOpen: boolean;
    mode: 'create' | 'edit-schedule';
    habitId: string | null;
    initialName: string;
    initialActiveDays: number[] | null;
  }>({
    isOpen: false,
    mode: 'create',
    habitId: null,
    initialName: '',
    initialActiveDays: null
  });

  // Year range: 2020 up to currentYear + 10
  const years = useMemo(() => {
    const startYear = 2020;
    const count = (now.getFullYear() + 10) - startYear;
    return Array.from({ length: count }, (_, i) => startYear + i);
  }, [now]);

  // Load habits and logs from SQLite WASM whenever month changes, guarded against stale resolutions
  const loadData = useCallback(async (targetMonthKey = monthKey) => {
    const seq = ++loadSeqRef.current;
    setIsDbLoading(true);
    setLoadError(null);
    try {
      const [loadedHabits, loadedLogs] = await Promise.all([
        getHabitsForMonth(targetMonthKey),
        getAllHabitLogs()
      ]);
      if (seq !== loadSeqRef.current) return;
      setHabits(loadedHabits);
      setLogs(loadedLogs);
      const persistErr = getPersistenceError();
      if (persistErr) {
        showStatus(persistErr, true, 5000);
      }
    } catch (err: any) {
      if (seq !== loadSeqRef.current) return;
      console.error('Failed to load data from SQLite:', err);
      setLoadError(err?.message || 'Failed to initialize SQLite database');
    } finally {
      if (seq === loadSeqRef.current) {
        setIsDbLoading(false);
      }
    }
  }, [monthKey, showStatus]);

  useEffect(() => {
    setEditingId(null);
    loadData(monthKey);
  }, [monthKey, loadData]);

  // Subscribe only to full-DB replacements (imports or resets)
  useEffect(() => {
    const unsubscribe = subscribeToDatabaseChanges(() => {
      loadData(monthKey);
    });
    return unsubscribe;
  }, [monthKey, loadData]);

  const daysInMonth = useMemo(() => getDaysInMonth(currentMonth, currentYear), [currentMonth, currentYear]);

  const cycleRemaining = useMemo(() => {
    const curY = now.getFullYear();
    const curM = now.getMonth();
    if (currentYear < curY || (currentYear === curY && currentMonth < curM)) {
      return { days: 0, label: 'Month completed' };
    }
    if (currentYear === curY && currentMonth === curM) {
      return { days: Math.max(0, daysInMonth - now.getDate()), label: 'Days left in active month' };
    }
    return { days: daysInMonth, label: 'Upcoming full month cycle' };
  }, [currentYear, currentMonth, daysInMonth, now]);

  const dailyStats = useMemo<DayStats[]>(() => {
    const stats: DayStats[] = [];
    for (let i = 1; i <= daysInMonth; i++) {
      const dateKey = formatDateKey(currentYear, currentMonth, i);
      let available = 0;
      let completed = 0;
      habits.forEach(habit => {
        if (!isDayOpenForHabit(habit, i)) return;
        available++;
        if (logs[habit.id]?.[dateKey]) completed++;
      });
      const notCompleted = available - completed;
      stats.push({
        date: dateKey,
        dayOfMonth: i,
        dayOfWeek: getDayName(new Date(currentYear, currentMonth, i)),
        completed,
        notCompleted,
        available,
        percentage: available > 0 ? Math.round((completed / available) * 100) : 0
      });
    }
    return stats;
  }, [currentMonth, currentYear, habits, logs, daysInMonth]);

  const scheduledDailyStats = useMemo(
    () => dailyStats.filter((s) => s.available > 0),
    [dailyStats]
  );

  const handleToggleHabit = async (habitId: string, day: number) => {
    if (isDbLoading) return;
    const targetHabit = habits.find(h => h.id === habitId);
    if (!targetHabit || !isDayOpenForHabit(targetHabit, day)) return;

    const dateKey = formatDateKey(currentYear, currentMonth, day);
    // Optimistic UI update
    setLogs(prev => ({
      ...prev,
      [habitId]: {
        ...prev[habitId],
        [dateKey]: !prev[habitId]?.[dateKey]
      }
    }));

    // Commit to SQLite WASM
    try {
      await toggleHabitDate(habitId, dateKey);
      const persistErr = getPersistenceError();
      if (persistErr) showStatus(persistErr, true, 5000);
    } catch (e: any) {
      console.error('Error toggling habit date in SQLite:', e);
      showStatus(e?.message || 'Failed to save habit progress', true);
      loadData(monthKey);
    }
  };

  const handleOpenCreateGoalModal = () => {
    if (isDbLoading) return;
    setGoalModalState({
      isOpen: true,
      mode: 'create',
      habitId: null,
      initialName: '',
      initialActiveDays: null
    });
  };

  const handleOpenScheduleModal = (habit: Habit) => {
    if (isDbLoading) return;
    setGoalModalState({
      isOpen: true,
      mode: 'edit-schedule',
      habitId: habit.id,
      initialName: habit.name,
      initialActiveDays: habit.activeDays ?? null
    });
  };

  const handleCloseGoalModal = () => {
    if (isSavingGoal) return;
    setGoalModalState(prev => ({ ...prev, isOpen: false }));
  };

  const handleGoalModalSubmit = async (name: string, activeDays: number[] | null) => {
    setIsSavingGoal(true);
    try {
      if (goalModalState.mode === 'create') {
        const newHabit = await addHabitToMonth(monthKey, name, activeDays);
        setHabits(prev => [...prev, newHabit]);
      } else if (goalModalState.habitId) {
        const targetId = goalModalState.habitId;
        const normalizedDays = await updateHabitSchedule(targetId, monthKey, activeDays);
        if (name !== goalModalState.initialName) {
          await updateHabitName(targetId, monthKey, name);
        }
        setHabits(prev =>
          prev.map(h =>
            h.id === targetId ? { ...h, name, activeDays: normalizedDays } : h
          )
        );
      }
      setGoalModalState(prev => ({ ...prev, isOpen: false }));
      const persistErr = getPersistenceError();
      if (persistErr) showStatus(persistErr, true, 5000);
    } catch (e: any) {
      console.error('Error saving goal in SQLite:', e);
      showStatus(e?.message || 'Failed to save objective', true);
    } finally {
      setIsSavingGoal(false);
    }
  };

  const handleDeleteHabit = async (id: string) => {
    if (isDbLoading) return;
    try {
      await deleteHabitFromMonth(id, monthKey);
      setHabits(prev => prev.filter(h => h.id !== id));
      if (editingId === id) setEditingId(null);
      const persistErr = getPersistenceError();
      if (persistErr) showStatus(persistErr, true, 5000);
    } catch (e: any) {
      console.error('Error deleting habit from SQLite:', e);
      showStatus(e?.message || 'Failed to delete objective', true);
    }
  };

  const handleSaveEdit = async () => {
    const targetId = editingId;
    if (!targetId) return;
    setEditingId(null);
    const trimmed = editValue.trim() || "Untitled Objective";
    try {
      await updateHabitName(targetId, monthKey, trimmed);
      setHabits(prev => prev.map(h => h.id === targetId ? { ...h, name: trimmed } : h));
      const persistErr = getPersistenceError();
      if (persistErr) showStatus(persistErr, true, 5000);
    } catch (e: any) {
      console.error('Error saving habit name in SQLite:', e);
      showStatus(e?.message || 'Failed to rename objective', true);
    }
  };

  const handleCancelEdit = () => {
    setEditingId(null);
  };

  const handleStartEditing = (habit: Habit) => {
    setEditingId(habit.id);
    setEditValue(habit.name);
  };

  const handleExportDatabase = async () => {
    try {
      await exportDatabaseFile();
      showStatus('Database exported successfully as .sqlite');
    } catch (e: any) {
      console.error('Export error:', e);
      showStatus(e?.message || 'Failed to export SQLite database', true);
    }
  };

  const handleImportClick = () => {
    if (isDbLoading) return;
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsDbLoading(true);
    try {
      const result = await importDatabaseFile(file);
      showStatus(result.message, !result.success, 4000);
    } catch (err: any) {
      showStatus(err?.message || 'Failed to import database file', true, 4000);
    } finally {
      setIsDbLoading(false);
    }
  };

  const handleResetConfirm = async () => {
    setIsDbLoading(true);
    try {
      await resetDatabaseWithDefaults();
      setShowResetConfirm(false);
      showStatus('Database reset with default objectives');
    } catch (err: any) {
      console.error('Failed to reset database:', err);
      showStatus(err?.message || 'Failed to reset SQLite database', true, 4000);
    } finally {
      setIsDbLoading(false);
    }
  };

  const nextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear(prev => prev + 1);
    } else {
      setCurrentMonth(prev => prev + 1);
    }
  };

  const prevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear(prev => prev - 1);
    } else {
      setCurrentMonth(prev => prev - 1);
    }
  };

  return (
    <div className="min-h-screen pb-16 bg-[#191919] text-[#EDEDEB] font-sans antialiased">
      {/* Hidden file input for .sqlite file import */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept=".sqlite,.db,.sqlite3"
        className="hidden"
      />

      {/* Notion Top Bar Contract - Responsive */}
      <header className="bg-[#191919] border-b border-[#2F2F2F] sticky top-0 z-40">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-2.5 lg:py-0 lg:h-14 flex flex-wrap items-center justify-between gap-3">
          {/* Brand Zone */}
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="w-7 h-7 rounded bg-[#252525] border border-[#373737] flex items-center justify-center text-[#EDEDEB]">
              {isDbLoading ? <Loader2 size={15} className="animate-spin" /> : <Database size={15} />}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold tracking-tight text-[#EDEDEB] whitespace-nowrap">
                Habit Matrix
              </span>
              <span className="hidden sm:inline-block text-[11px] text-[#787774] font-mono-numbers px-1.5 py-0.5 rounded bg-[#202020] border border-[#2F2F2F]">
                SQLite WASM
              </span>
            </div>
          </div>

          {/* Center Month Switcher */}
          <div className="order-3 lg:order-2 w-full lg:w-auto flex items-center justify-center bg-[#202020] border border-[#2F2F2F] rounded p-0.5 shadow-sm">
            <button
              onClick={prevMonth}
              disabled={isDbLoading}
              className="p-1.5 hover:bg-[#2A2A2A] disabled:opacity-40 rounded transition-colors text-[#9B9A97] hover:text-[#EDEDEB]"
              title="Previous Month"
            >
              <ChevronLeft size={15} />
            </button>
            <div className="px-3 flex items-center gap-1.5">
              <select
                aria-label="Month"
                disabled={isDbLoading}
                className="bg-transparent text-xs font-semibold focus:outline-none cursor-pointer text-[#EDEDEB] tracking-wide appearance-none text-center disabled:opacity-50"
                value={currentMonth}
                onChange={(e) => setCurrentMonth(parseInt(e.target.value, 10))}
              >
                {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
              </select>
              <span className="text-[#555555]">/</span>
              <select
                aria-label="Year"
                disabled={isDbLoading}
                className="bg-transparent text-xs font-semibold focus:outline-none cursor-pointer text-[#EDEDEB] appearance-none disabled:opacity-50"
                value={currentYear}
                onChange={(e) => setCurrentYear(parseInt(e.target.value, 10))}
              >
                {years.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <button
              onClick={nextMonth}
              disabled={isDbLoading}
              className="p-1.5 hover:bg-[#2A2A2A] disabled:opacity-40 rounded transition-colors text-[#9B9A97] hover:text-[#EDEDEB]"
              title="Next Month"
            >
              <ChevronRight size={15} />
            </button>
          </div>

          {/* Action Zone: DB Controls & New Goal */}
          <div className="order-2 lg:order-3 flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              onClick={handleExportDatabase}
              disabled={isDbLoading}
              title="Download your entire SQLite database to computer"
              className="h-8 px-2 sm:px-2.5 bg-[#202020] hover:bg-[#2A2A2A] disabled:opacity-40 border border-[#2F2F2F] text-[#EDEDEB] rounded text-xs font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap"
            >
              <Download size={13} className="text-[#9B9A97]" />
              <span className="hidden sm:inline">Export .sqlite</span>
            </button>

            <button
              onClick={handleImportClick}
              disabled={isDbLoading}
              title="Upload and restore a .sqlite database file"
              className="h-8 px-2 sm:px-2.5 bg-[#202020] hover:bg-[#2A2A2A] disabled:opacity-40 border border-[#2F2F2F] text-[#EDEDEB] rounded text-xs font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap"
            >
              <Upload size={13} className="text-[#9B9A97]" />
              <span className="hidden sm:inline">Import .sqlite</span>
            </button>

            <button
              onClick={() => setShowResetConfirm(true)}
              disabled={isDbLoading}
              title="Reset database to fresh defaults"
              className="h-8 w-8 bg-[#202020] hover:bg-[#2A2A2A] disabled:opacity-40 border border-[#2F2F2F] text-[#9B9A97] hover:text-[#EDEDEB] rounded flex items-center justify-center transition-colors"
            >
              <RotateCcw size={13} />
            </button>

            <button
              onClick={handleOpenCreateGoalModal}
              disabled={isDbLoading}
              className="h-8 px-2.5 sm:px-3 bg-[#EDEDEB] hover:bg-white disabled:opacity-40 text-[#191919] font-medium rounded text-xs transition-colors flex items-center gap-1.5 shadow-sm whitespace-nowrap"
            >
              <Plus size={14} />
              <span>New Goal</span>
            </button>
          </div>
        </div>
      </header>

      {/* Error Banner for Database Load Failure */}
      {loadError && (
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 mt-3">
          <div className="bg-[#2A1B1B] border border-[#5C2B2B] px-4 py-2.5 rounded text-xs text-[#F5B5B5] flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <AlertCircle size={14} className="shrink-0" />
              <span>{loadError}</span>
            </div>
            <button
              onClick={() => loadData(monthKey)}
              className="px-2.5 py-1 bg-[#3D2323] hover:bg-[#4D2C2C] text-[#EDEDEB] rounded text-[11px] font-medium shrink-0"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Floating Status Notification Toast */}
      {dbStatus && (
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 mt-3">
          <div
            className={`border px-4 py-2 rounded text-xs flex items-center justify-between ${
              dbStatus.isError
                ? 'bg-[#2A1B1B] border-[#5C2B2B] text-[#F5B5B5]'
                : 'bg-[#202020] border-[#2F2F2F] text-[#EDEDEB]'
            }`}
          >
            <div className="flex items-center gap-2">
              {dbStatus.isError ? <AlertCircle size={13} /> : <Database size={13} />}
              <span>{dbStatus.text}</span>
            </div>
            <button onClick={() => setDbStatus(null)} className="text-[#787774] hover:text-[#EDEDEB]">×</button>
          </div>
        </div>
      )}

      {/* Reset Confirmation Dialog */}
      {showResetConfirm && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-[#202020] border border-[#2F2F2F] rounded-lg max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-3 text-[#EDEDEB]">
              <AlertCircle size={20} className="text-[#EDEDEB]" />
              <h3 className="text-sm font-semibold">Reset SQLite Database?</h3>
            </div>
            <p className="text-xs text-[#9B9A97] leading-relaxed mb-6">
              This will re-initialize the local database with default executive habits and clear logged history. You can export a backup first if you wish.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setShowResetConfirm(false)}
                disabled={isDbLoading}
                className="px-3 py-1.5 bg-[#252525] hover:bg-[#2A2A2A] disabled:opacity-40 text-xs font-medium text-[#EDEDEB] rounded border border-[#2F2F2F]"
              >
                Cancel
              </button>
              <button
                onClick={handleResetConfirm}
                disabled={isDbLoading}
                className="px-3 py-1.5 bg-[#EDEDEB] hover:bg-white disabled:opacity-40 text-xs font-medium text-[#191919] rounded flex items-center gap-1.5"
              >
                {isDbLoading && <Loader2 size={12} className="animate-spin" />}
                <span>Confirm Reset</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create / Edit Goal Schedule Modal */}
      <GoalModal
        isOpen={goalModalState.isOpen}
        mode={goalModalState.mode}
        initialName={goalModalState.initialName}
        initialActiveDays={goalModalState.initialActiveDays}
        monthName={MONTHS[currentMonth]}
        monthIndex={currentMonth}
        year={currentYear}
        daysInMonth={daysInMonth}
        isSubmitting={isSavingGoal}
        onClose={handleCloseGoalModal}
        onSubmit={handleGoalModalSubmit}
      />

      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 pt-6">
        {/* Statistics Cards - Notion Dark Styling */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <div className="bg-[#202020] p-4 rounded border border-[#2F2F2F]">
            <div className="flex items-center justify-between text-[#9B9A97] mb-1.5">
              <span className="text-[11px] font-medium tracking-wide">Aggregate Output</span>
              <TrendingUp size={13} className="text-[#9B9A97]" />
            </div>
            <div className="text-2xl font-bold text-[#EDEDEB] font-mono-numbers">
              {scheduledDailyStats.length > 0
                ? Math.round(scheduledDailyStats.reduce((a, b) => a + b.completed, 0) / scheduledDailyStats.length)
                : 0}
              <span className="text-xs font-normal text-[#787774] ml-1.5 font-sans">goals/day</span>
            </div>
            <div className="text-[10px] text-[#787774] mt-1">Average daily completion</div>
          </div>

          <div className="bg-[#202020] p-4 rounded border border-[#2F2F2F]">
            <div className="flex items-center justify-between text-[#9B9A97] mb-1.5">
              <span className="text-[11px] font-medium tracking-wide">Consistency Rate</span>
              <Target size={13} className="text-[#9B9A97]" />
            </div>
            <div className="text-2xl font-bold text-[#EDEDEB] font-mono-numbers">
              {scheduledDailyStats.filter(s => s.percentage >= 50).length}
              <span className="text-xs font-normal text-[#787774] ml-1.5 font-sans">days</span>
            </div>
            <div className="text-[10px] text-[#787774] mt-1">Above 50% target execution</div>
          </div>

          <div className="bg-[#202020] p-4 rounded border border-[#2F2F2F]">
            <div className="flex items-center justify-between text-[#9B9A97] mb-1.5">
              <span className="text-[11px] font-medium tracking-wide">Efficiency Score</span>
              <span className="text-[10px] font-mono text-[#9B9A97]">{daysInMonth}D</span>
            </div>
            <div className="text-2xl font-bold text-[#EDEDEB] font-mono-numbers">
              {scheduledDailyStats.length > 0
                ? Math.round(scheduledDailyStats.reduce((a, b) => a + b.percentage, 0) / scheduledDailyStats.length)
                : 0}%
            </div>
            <div className="text-[10px] text-[#787774] mt-1">Monthly performance index</div>
          </div>

          <div className="bg-[#202020] p-4 rounded border border-[#2F2F2F]">
            <div className="flex items-center justify-between text-[#9B9A97] mb-1.5">
              <span className="text-[11px] font-medium tracking-wide">Cycle Remaining</span>
              <Calendar size={13} className="text-[#9B9A97]" />
            </div>
            <div className="text-2xl font-bold text-[#EDEDEB] font-mono-numbers">
              {cycleRemaining.days}
              <span className="text-xs font-normal text-[#787774] ml-1.5 font-sans">days</span>
            </div>
            <div className="text-[10px] text-[#787774] mt-1">{cycleRemaining.label}</div>
          </div>
        </div>

        {/* Analytic Visualization: Monochrome Notion Style */}
        <div className="bg-[#202020] rounded border border-[#2F2F2F] mb-6 overflow-hidden">
          <div className="px-5 py-3 border-b border-[#2F2F2F] flex items-center justify-between bg-[#1C1C1C]">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-[#EDEDEB]">Daily Execution Variance</span>
              <span className="text-[11px] text-[#787774]">·</span>
              <span className="text-[11px] text-[#787774]">Real-time completion percentage</span>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-[#9B9A97]">
              <span className="inline-block w-2.5 h-0.5 bg-[#EDEDEB]"></span>
              <span className="font-mono-numbers">Execution %</span>
            </div>
          </div>
          <div className="p-4 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dailyStats} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                <defs>
                  <linearGradient id="notionMonochromeGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#EDEDEB" stopOpacity={0.16} />
                    <stop offset="95%" stopColor="#EDEDEB" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#2A2A2A" />
                <XAxis
                  dataKey="dayOfMonth"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10, fill: '#787774', fontFamily: 'JetBrains Mono' }}
                />
                <YAxis
                  domain={[0, 100]}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10, fill: '#787774', fontFamily: 'JetBrains Mono' }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#202020',
                    border: '1px solid #2F2F2F',
                    borderRadius: '4px',
                    color: '#EDEDEB',
                    fontSize: '11px',
                    fontFamily: 'JetBrains Mono',
                    boxShadow: '0 4px 16px rgba(0,0,0,0.4)'
                  }}
                  itemStyle={{ color: '#EDEDEB' }}
                  cursor={{ stroke: '#383838', strokeWidth: 1 }}
                />
                <Area
                  type="monotone"
                  dataKey="percentage"
                  stroke="#EDEDEB"
                  strokeWidth={1.75}
                  fillOpacity={1}
                  fill="url(#notionMonochromeGrad)"
                  dot={{ r: 2, fill: '#EDEDEB', strokeWidth: 0 }}
                  activeDot={{ r: 4, stroke: '#FFFFFF', strokeWidth: 2, fill: '#191919' }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Matrix Table: Notion Dark Grid */}
        <div className="bg-[#202020] rounded border border-[#2F2F2F] overflow-hidden shadow-lg">
          <div className="px-4 sm:px-5 py-3 border-b border-[#2F2F2F] flex flex-wrap items-center justify-between gap-2 bg-[#1C1C1C]">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-[#EDEDEB]">Operational Execution Matrix</span>
              <span className="text-[11px] text-[#787774]">·</span>
              <span className="text-[11px] text-[#787774] font-mono-numbers">{habits.length} objectives tracked</span>
            </div>
            <div className="text-[11px] text-[#787774]">
              {isDbLoading ? 'Syncing SQLite database...' : 'Changes auto-saved to SQLite'}
            </div>
          </div>

          {isDbLoading && habits.length === 0 ? (
            <div className="p-6 space-y-3">
              {[0, 1, 2, 3, 4].map((idx) => (
                <div key={idx} className="h-9 bg-[#252525] rounded animate-pulse border border-[#2A2A2A]" />
              ))}
            </div>
          ) : !isDbLoading && habits.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="text-sm font-medium text-[#EDEDEB] mb-1">No objectives tracked for {MONTHS[currentMonth]} {currentYear}</p>
              <p className="text-xs text-[#787774] mb-4">Create your first strategic objective to start logging daily execution.</p>
              <button
                onClick={handleOpenCreateGoalModal}
                className="px-3.5 py-2 bg-[#EDEDEB] hover:bg-white text-[#191919] text-xs font-medium rounded inline-flex items-center gap-1.5 transition-colors"
              >
                <Plus size={14} />
                <span>Add First Objective</span>
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse min-w-[900px]">
                <thead>
                  <tr className="bg-[#191919] border-b border-[#2F2F2F]">
                    <th className="w-40 min-w-[160px] sm:w-56 sm:min-w-[224px] md:w-64 md:min-w-[256px] bg-[#191919] border-r border-[#2F2F2F] p-3 text-left text-[#9B9A97] font-medium tracking-wide sticky left-0 z-20">
                      Strategic Objectives
                    </th>
                    {dailyStats.map((day) => (
                      <th key={day.date} className="border-r border-[#2F2F2F] p-2 min-w-[40px]">
                        <div className="flex flex-col items-center">
                          <span className="text-[9px] font-medium text-[#787774] uppercase">{day.dayOfWeek}</span>
                          <span className="text-xs font-bold text-[#EDEDEB] font-mono-numbers">{day.dayOfMonth}</span>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#2A2A2A]">
                  {/* Achievement Summary Row */}
                  <tr className="bg-[#1E1E1E]">
                    <td className="sticky left-0 bg-[#1E1E1E] border-r border-[#2F2F2F] p-3 font-medium text-[#9B9A97] text-[10px] tracking-wide z-10">
                      Achievement Rate
                    </td>
                    {dailyStats.map(s => (
                      <td
                        key={s.date}
                        className={`text-center border-r border-[#2F2F2F] p-2 font-mono-numbers font-semibold text-[11px] ${
                          s.available === 0
                            ? 'text-[#444444]'
                            : s.percentage >= 80
                              ? 'text-[#EDEDEB]'
                              : s.percentage >= 40
                                ? 'text-[#9B9A97]'
                                : 'text-[#555555]'
                        }`}
                      >
                        {s.available === 0 ? '—' : `${s.percentage}%`}
                      </td>
                    ))}
                  </tr>

                  {/* Habit Rows */}
                  {habits.map((habit) => {
                    const activeCountInMonth = habit.activeDays
                      ? habit.activeDays.filter((d) => d >= 1 && d <= daysInMonth).length
                      : null;
                    return (
                      <tr key={habit.id} className="group hover:bg-[#252525] transition-colors">
                        <td className="sticky left-0 bg-[#202020] group-hover:bg-[#252525] border-r border-[#2F2F2F] p-2.5 sm:p-3 z-10 w-40 min-w-[160px] sm:w-56 sm:min-w-[224px] md:w-64 md:min-w-[256px]">
                          {editingId === habit.id ? (
                            <div className="flex items-center gap-1.5 w-full">
                              <input
                                autoFocus
                                className="flex-1 min-w-0 bg-[#191919] border border-[#373737] rounded px-2 py-1 text-xs text-[#EDEDEB] focus:outline-none focus:border-[#EDEDEB]"
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onBlur={handleSaveEdit}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    handleSaveEdit();
                                  }
                                  if (e.key === 'Escape') {
                                    e.preventDefault();
                                    handleCancelEdit();
                                  }
                                }}
                              />
                              <button
                                type="button"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={handleSaveEdit}
                                className="p-1 text-[#EDEDEB] hover:bg-[#333333] rounded shrink-0"
                                title="Save"
                              >
                                <Check size={13} />
                              </button>
                            </div>
                          ) : (
                            <div className="flex justify-between items-center gap-1.5 w-full">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className="font-medium text-[#EDEDEB] truncate">{habit.name}</span>
                                {activeCountInMonth !== null && (
                                  <span
                                    className="text-[10px] font-mono-numbers text-[#787774] shrink-0"
                                    title={`Active on ${activeCountInMonth} specific date${activeCountInMonth === 1 ? '' : 's'} this month`}
                                  >
                                    · {activeCountInMonth}d
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-0.5 shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 transition-opacity">
                                <button
                                  onClick={() => handleOpenScheduleModal(habit)}
                                  className="text-[#787774] hover:text-[#EDEDEB] focus-visible:text-[#EDEDEB] p-1 rounded hover:bg-[#2A2A2A]"
                                  title="Edit Active Dates"
                                  aria-label={`Edit schedule for ${habit.name}`}
                                >
                                  <Calendar size={12} />
                                </button>
                                <button
                                  onClick={() => handleStartEditing(habit)}
                                  className="text-[#787774] hover:text-[#EDEDEB] focus-visible:text-[#EDEDEB] p-1 rounded hover:bg-[#2A2A2A]"
                                  title="Rename Objective"
                                  aria-label={`Rename ${habit.name}`}
                                >
                                  <Edit2 size={12} />
                                </button>
                                <button
                                  onClick={() => handleDeleteHabit(habit.id)}
                                  className="text-[#787774] hover:text-[#EDEDEB] focus-visible:text-[#EDEDEB] p-1 rounded hover:bg-[#2A2A2A]"
                                  title="Delete Objective"
                                  aria-label={`Delete ${habit.name}`}
                                >
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            </div>
                          )}
                        </td>
                        {dailyStats.map((day) => {
                          const isOpen = isDayOpenForHabit(habit, day.dayOfMonth);
                          if (!isOpen) {
                            return (
                              <td
                                key={day.date}
                                className="border-r border-[#2F2F2F] p-0 h-11 w-10 sm:w-11 bg-[#161616]"
                              >
                                <div
                                  className="w-full h-full flex items-center justify-center cursor-not-allowed select-none"
                                  aria-disabled="true"
                                  title={`${habit.name} - Day ${day.dayOfMonth}: Closed`}
                                >
                                  <div className="w-5 h-5 rounded-[3px] border border-[#242424] bg-[#1A1A1A] flex items-center justify-center text-[#363636]">
                                    <svg
                                      viewBox="0 0 16 16"
                                      className="w-3 h-3"
                                      aria-hidden="true"
                                    >
                                      <line
                                        x1="3.5"
                                        y1="12.5"
                                        x2="12.5"
                                        y2="3.5"
                                        stroke="currentColor"
                                        strokeWidth="1.5"
                                        strokeLinecap="round"
                                      />
                                    </svg>
                                  </div>
                                </div>
                              </td>
                            );
                          }

                          const isChecked = !!logs[habit.id]?.[day.date];
                          return (
                            <td key={day.date} className="border-r border-[#2F2F2F] p-0 h-11 w-10 sm:w-11">
                              <button
                                onClick={() => handleToggleHabit(habit.id, day.dayOfMonth)}
                                disabled={isDbLoading}
                                className="w-full h-full flex items-center justify-center transition-colors hover:bg-[#282828] disabled:opacity-50"
                                title={`${habit.name} - Day ${day.dayOfMonth}: ${isChecked ? 'Completed' : 'Incomplete'}`}
                                aria-label={`${habit.name}, day ${day.dayOfMonth}, ${isChecked ? 'completed' : 'incomplete'}`}
                              >
                                <div
                                  className={`w-5 h-5 rounded-[3px] border flex items-center justify-center transition-all ${
                                    isChecked
                                      ? 'bg-[#EDEDEB] border-[#EDEDEB] text-[#191919]'
                                      : 'border-[#373737] bg-[#222222] hover:border-[#666666]'
                                  }`}
                                >
                                  {isChecked && <Check size={12} strokeWidth={3.5} />}
                                </div>
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {/* Notion Minimalist Footer */}
      <footer className="max-w-[1600px] mx-auto px-6 mt-10 pt-4 border-t border-[#2F2F2F] flex flex-col sm:flex-row justify-between items-center text-[11px] text-[#787774] gap-2">
        <div className="flex items-center gap-2">
          <span>Notion Habit Matrix</span>
          <span>·</span>
          <span>In-browser SQLite (WASM)</span>
          <span>·</span>
          <span>Local IndexedDB Persistence</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleExportDatabase}
            className="hover:text-[#EDEDEB] transition-colors"
          >
            Export Backup (.sqlite)
          </button>
          <span>·</span>
          <button
            onClick={handleImportClick}
            className="hover:text-[#EDEDEB] transition-colors"
          >
            Import Backup
          </button>
        </div>
      </footer>
    </div>
  );
};

export default App;