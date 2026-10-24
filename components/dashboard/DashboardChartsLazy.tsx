"use client";

import dynamic from 'next/dynamic';
import SkeletonLoader from '@/components/SkeletonLoader';

// Dynamically import charts with no SSR to prevent blocking initial load
const DashboardCharts = dynamic(
  () => import('./DashboardCharts'),
  {
    ssr: false,
    loading: () => <SkeletonLoader />,
  }
);

export default DashboardCharts;















