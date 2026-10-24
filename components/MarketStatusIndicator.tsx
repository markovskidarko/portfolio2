"use client";

import React, { useState, useEffect } from 'react';
import { getMarketStatusColor } from '@/lib/utils';

interface MarketStatusIndicatorProps {
  className?: string;
  title?: string;
}

/**
 * Market status: green = regular (9:30–16:00 ET), amber = pre/post, red = closed.
 */
export default function MarketStatusIndicator({ 
  className = "", 
  title = "Market Status" 
}: MarketStatusIndicatorProps) {
  const [color, setColor] = useState<'green' | 'amber' | 'red'>('green');

  useEffect(() => {
    // Update color based on NY market hours
    const updateColor = () => {
      setColor(getMarketStatusColor());
    };

    // Update immediately
    updateColor();

    // Update every minute to handle timezone changes
    const interval = setInterval(updateColor, 60000);

    return () => clearInterval(interval);
  }, []);

  const bgColor =
    color === 'green' ? 'bg-green-400' : color === 'amber' ? 'bg-amber-400' : 'bg-red-400';
  const solidColor =
    color === 'green' ? 'bg-green-500' : color === 'amber' ? 'bg-amber-500' : 'bg-red-500';

  return (
    <span className={`relative flex h-3 w-3 ${className}`} title={title}>
      <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${bgColor} opacity-75`}></span>
      <span className={`relative inline-flex rounded-full h-3 w-3 ${solidColor}`}></span>
    </span>
  );
}












