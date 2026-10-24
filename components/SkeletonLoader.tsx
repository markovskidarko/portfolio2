"use client";

import React from 'react';

export default function SkeletonLoader() {
  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header Skeleton */}
        <div className="space-y-4">
          <div className="h-8 bg-muted rounded-lg w-64 animate-pulse" />
          <div className="h-4 bg-muted rounded w-48 animate-pulse" />
        </div>

        {/* Stats Cards Skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-card border border-border rounded-lg p-6">
              <div className="h-4 bg-muted rounded w-24 mb-4 animate-pulse" />
              <div className="h-8 bg-muted rounded w-32 mb-2 animate-pulse" />
              <div className="h-3 bg-muted rounded w-20 animate-pulse" />
            </div>
          ))}
        </div>

        {/* Chart Skeleton */}
        <div className="bg-card border border-border rounded-lg p-6">
          <div className="h-6 bg-muted rounded w-40 mb-4 animate-pulse" />
          <div className="h-64 bg-muted rounded animate-pulse" />
        </div>

        {/* Holdings Table Skeleton */}
        <div className="bg-card border border-border rounded-lg p-6">
          <div className="h-6 bg-muted rounded w-32 mb-4 animate-pulse" />
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-center justify-between py-3 border-b border-border last:border-0">
                <div className="flex items-center space-x-4 flex-1">
                  <div className="h-4 bg-muted rounded w-16 animate-pulse" />
                  <div className="h-4 bg-muted rounded w-32 animate-pulse" />
                </div>
                <div className="flex items-center space-x-4">
                  <div className="h-4 bg-muted rounded w-20 animate-pulse" />
                  <div className="h-4 bg-muted rounded w-24 animate-pulse" />
                  <div className="h-4 bg-muted rounded w-16 animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Loading Message */}
        <div className="text-center py-8">
          <div className="inline-flex items-center space-x-2 text-muted-foreground">
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-sm font-medium">Syncing data...</span>
          </div>
        </div>
      </div>
    </div>
  );
}















