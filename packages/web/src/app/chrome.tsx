import { createContext, useContext, type ReactNode } from 'react';

const LeadingClearanceContext = createContext(0);

/** `embed=main` 时由 `bm:chrome` 写入；其他模式固定为 0。 */
export function LeadingClearanceProvider({ value, children }: { value: number; children: ReactNode }) {
  return <LeadingClearanceContext.Provider value={value}>{children}</LeadingClearanceContext.Provider>;
}

export function useLeadingClearance(): number {
  return useContext(LeadingClearanceContext);
}
