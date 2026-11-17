import React, { useState, useEffect, useMemo } from 'react';
import { Calendar, X, Loader2 } from 'lucide-react';

interface GoalModalProps {
  isOpen: boolean;
  mode: 'create' | 'edit-schedule';
  initialName: string;
  initialActiveDays: number[] | null;
  monthName: string;
  monthIndex: number;
  year: number;
  daysInMonth: number;
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (name: string, activeDays: number[] | null) => void;
}

const WEEKDAY_HEADERS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export const GoalModal: React.FC<GoalModalProps> = ({
  isOpen,
  mode,
  initialName,
  initialActiveDays,
  monthName,
  monthIndex,
  year,
  daysInMonth,
  isSubmitting,
  onClose,
  onSubmit
}) => {
  const [name, setName] = useState(initialName);
  const [scheduleMode, setScheduleMode] = useState<'all' | 'specific'>(
    initialActiveDays ? 'specific' : 'all'
  );
  const [selectedDays, setSelectedDays] = useState<Set<number>>(() => {
    if (!initialActiveDays) return new Set();
    return new Set(initialActiveDays.filter((d) => d >= 1 && d <= daysInMonth));
  });

  useEffect(() => {
    if (!isOpen) return;
    setName(initialName);
    setScheduleMode(initialActiveDays ? 'specific' : 'all');
    setSelectedDays(
      initialActiveDays
        ? new Set(initialActiveDays.filter((d) => d >= 1 && d <= daysInMonth))
        : new Set()
    );
  }, [isOpen, initialName, initialActiveDays, daysInMonth]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting, onClose]);

  const calendarCells = useMemo(() => {
    const firstWeekday = new Date(year, monthIndex, 1).getDay();
    const cells: Array<number | null> = [];
    for (let i = 0; i < firstWeekday; i++) {
      cells.push(null);
    }
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push(d);
    }
    return cells;
  }, [year, monthIndex, daysInMonth]);

  if (!isOpen) return null;

  const toggleDay = (day: number) => {
    setSelectedDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) {
        next.delete(day);
      } else {
        next.add(day);
      }
      return next;
    });
  };

  const selectWeekdays = () => {
    const next = new Set<number>();
    for (let d = 1; d <= daysInMonth; d++) {
      const dow = new Date(year, monthIndex, d).getDay();
      if (dow >= 1 && dow <= 5) next.add(d);
    }
    setSelectedDays(next);
  };

  const selectWeekends = () => {
    const next = new Set<number>();
    for (let d = 1; d <= daysInMonth; d++) {
      const dow = new Date(year, monthIndex, d).getDay();
      if (dow === 0 || dow === 6) next.add(d);
    }
    setSelectedDays(next);
  };

  const selectAllDays = () => {
    const next = new Set<number>();
    for (let d = 1; d <= daysInMonth; d++) {
      next.add(d);
    }
    setSelectedDays(next);
  };

  const clearDays = () => {
    setSelectedDays(new Set());
  };

  const trimmedName = name.trim();
  const isSpecificInvalid = scheduleMode === 'specific' && selectedDays.size === 0;
  const canSubmit = trimmedName.length > 0 && !isSpecificInvalid && !isSubmitting;

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    const activeDays =
      scheduleMode === 'all'
        ? null
        : Array.from<number>(selectedDays).sort((a, b) => a - b);
    onSubmit(trimmedName, activeDays);
  };

  return (
    <div
      className="fixed inset-0 bg-black/65 z-50 flex items-center justify-center p-4"
      onClick={() => {
        if (!isSubmitting) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="goal-modal-title"
    >
      <div
        className="bg-[#202020] border border-[#2F2F2F] rounded-lg max-w-md w-full p-5 sm:p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5 text-[#EDEDEB]">
            <Calendar size={16} className="text-[#9B9A97]" />
            <h3 id="goal-modal-title" className="text-sm font-semibold">
              {mode === 'create' ? 'New Goal' : 'Goal Schedule'}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="p-1 text-[#787774] hover:text-[#EDEDEB] hover:bg-[#2A2A2A] rounded transition-colors disabled:opacity-40"
            aria-label="Close modal"
          >
            <X size={15} />
          </button>
        </div>

        <form onSubmit={handleFormSubmit} className="space-y-4">
          {/* Goal Name */}
          <div>
            <label
              htmlFor="goal-name-input"
              className="block text-[11px] font-medium text-[#9B9A97] mb-1.5"
            >
              Objective Name
            </label>
            <input
              id="goal-name-input"
              type="text"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Deep Work Session (90 mins)"
              className="w-full bg-[#191919] border border-[#373737] focus:border-[#EDEDEB] rounded px-3 py-2 text-xs text-[#EDEDEB] placeholder-[#555555] focus:outline-none transition-colors"
            />
          </div>

          {/* Schedule Mode Selector */}
          <div>
            <span className="block text-[11px] font-medium text-[#9B9A97] mb-1.5">
              Active Dates ({monthName} {year})
            </span>
            <div className="grid grid-cols-2 gap-1 p-1 bg-[#191919] border border-[#2F2F2F] rounded">
              <button
                type="button"
                onClick={() => setScheduleMode('all')}
                className={`py-1.5 px-3 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                  scheduleMode === 'all'
                    ? 'bg-[#2A2A2A] text-[#EDEDEB] border border-[#3A3A3A]'
                    : 'text-[#787774] hover:text-[#EDEDEB] border border-transparent'
                }`}
              >
                All Month
              </button>
              <button
                type="button"
                onClick={() => setScheduleMode('specific')}
                className={`py-1.5 px-3 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                  scheduleMode === 'specific'
                    ? 'bg-[#2A2A2A] text-[#EDEDEB] border border-[#3A3A3A]'
                    : 'text-[#787774] hover:text-[#EDEDEB] border border-transparent'
                }`}
              >
                Specific Dates
              </button>
            </div>
          </div>

          {/* Mode Description or Date Picker Grid */}
          {scheduleMode === 'all' ? (
            <div className="bg-[#191919] border border-[#2F2F2F] rounded px-3.5 py-3 text-[11px] text-[#9B9A97] leading-relaxed">
              Every day in {monthName} {year} (<span className="font-mono-numbers text-[#EDEDEB]">{daysInMonth}</span> days) will be open and available to check.
            </div>
          ) : (
            <div className="bg-[#191919] border border-[#2F2F2F] rounded p-3.5 space-y-3">
              {/* Quick Selection Helpers */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] text-[#9B9A97]">
                  Select open dates
                </span>
                <div className="flex items-center gap-1.5 text-[11px]">
                  <button
                    type="button"
                    onClick={selectWeekdays}
                    className="px-2 py-0.5 bg-[#242424] hover:bg-[#2F2F2F] text-[#9B9A97] hover:text-[#EDEDEB] rounded border border-[#2F2F2F] transition-colors"
                  >
                    Weekdays
                  </button>
                  <button
                    type="button"
                    onClick={selectWeekends}
                    className="px-2 py-0.5 bg-[#242424] hover:bg-[#2F2F2F] text-[#9B9A97] hover:text-[#EDEDEB] rounded border border-[#2F2F2F] transition-colors"
                  >
                    Weekends
                  </button>
                  <button
                    type="button"
                    onClick={selectAllDays}
                    className="px-2 py-0.5 bg-[#242424] hover:bg-[#2F2F2F] text-[#9B9A97] hover:text-[#EDEDEB] rounded border border-[#2F2F2F] transition-colors"
                  >
                    All
                  </button>
                  <button
                    type="button"
                    onClick={clearDays}
                    className="px-2 py-0.5 bg-[#242424] hover:bg-[#2F2F2F] text-[#787774] hover:text-[#EDEDEB] rounded border border-[#2F2F2F] transition-colors"
                  >
                    Clear
                  </button>
                </div>
              </div>

              {/* Weekday Headers */}
              <div className="grid grid-cols-7 gap-1 text-center">
                {WEEKDAY_HEADERS.map((wd) => (
                  <div
                    key={wd}
                    className="text-[10px] font-medium text-[#787774] py-0.5 select-none"
                  >
                    {wd}
                  </div>
                ))}

                {/* Day Cells */}
                {calendarCells.map((day, index) => {
                  if (day === null) {
                    return <div key={`blank-${index}`} className="h-8" />;
                  }
                  const isSelected = selectedDays.has(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => toggleDay(day)}
                      aria-pressed={isSelected}
                      aria-label={`${monthName} ${day}, ${isSelected ? 'open' : 'closed'}`}
                      className={`h-8 rounded text-xs font-mono-numbers transition-colors border flex items-center justify-center ${
                        isSelected
                          ? 'bg-[#EDEDEB] text-[#191919] border-[#EDEDEB] font-semibold'
                          : 'bg-[#202020] text-[#787774] border-[#2F2F2F] hover:border-[#555555] hover:text-[#EDEDEB]'
                      }`}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>

              {/* Selection Summary */}
              <div className="pt-1 border-t border-[#2A2A2A] flex items-center justify-between text-[11px]">
                {selectedDays.size > 0 ? (
                  <span className="text-[#9B9A97]">
                    <span className="font-mono-numbers text-[#EDEDEB]">{selectedDays.size}</span> of{' '}
                    <span className="font-mono-numbers">{daysInMonth}</span> dates open · Others closed
                  </span>
                ) : (
                  <span className="text-[#9B9A97]">
                    Select at least one date to continue
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-3.5 py-1.5 bg-[#252525] hover:bg-[#2A2A2A] disabled:opacity-40 text-xs font-medium text-[#EDEDEB] rounded border border-[#2F2F2F] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="px-3.5 py-1.5 bg-[#EDEDEB] hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed text-xs font-medium text-[#191919] rounded flex items-center gap-1.5 transition-colors"
            >
              {isSubmitting && <Loader2 size={12} className="animate-spin" />}
              <span>{mode === 'create' ? 'Create Goal' : 'Save Schedule'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
