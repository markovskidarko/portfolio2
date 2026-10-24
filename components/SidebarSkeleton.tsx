"use client";

import React from 'react';

export default function SidebarSkeleton() {
  return (
    <div className="w-64 bg-card border-r border-border h-screen flex flex-col shadow-lg md:shadow-none">
      <div className="p-4 border-b border-border">
        <div className="flex items-center gap-2 mb-4">
          <div className="h-5 w-5 bg-muted rounded animate-pulse" />
          <div className="h-5 w-24 bg-muted rounded animate-pulse" />
        </div>
        <div className="flex gap-2">
          <div className="flex-1 h-9 bg-muted rounded animate-pulse" />
          <div className="flex-1 h-9 bg-muted rounded animate-pulse" />
        </div>
      </div>

      <div className="p-2 flex-1 overflow-y-auto space-y-2">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="w-full px-4 py-3 rounded-lg border-2 border-border bg-muted/50 animate-pulse"
          >
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-5 h-5 rounded-md bg-muted border-2 border-border" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-32 bg-muted rounded" />
                <div className="h-3 w-24 bg-muted rounded" />
                <div className="h-4 w-20 bg-muted rounded mt-2" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}












