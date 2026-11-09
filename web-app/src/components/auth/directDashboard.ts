"use client";

import { createContext, type ReactNode } from "react";
import type { RoleDashboardProps } from "@/dashboards/shell";

/**
 * Draws the dashboard without a lazy boundary (R48). Only a page the server rendered for a verified session provides it (SeededApp), so its sidebar
 * and top bar are in the very first HTML with nothing streamed before them. Elsewhere it is null and SignedInStep loads the dashboard on demand.
 */
export const DirectDashboard = createContext<((props: RoleDashboardProps) => ReactNode) | null>(null);
