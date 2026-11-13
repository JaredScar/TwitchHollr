import { inject } from '@angular/core';
import { Router, type Routes } from '@angular/router';
import { HollrService } from './core/hollr.service';

const requireOnboarding = () => {
  const hollr = inject(HollrService);
  return hollr.settings()?.onboardingComplete ? true : inject(Router).parseUrl('/onboarding');
};

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  {
    path: 'dashboard',
    canActivate: [requireOnboarding],
    loadComponent: () => import('./pages/dashboard/dashboard.page').then((m) => m.DashboardPage),
  },
  {
    path: 'settings',
    loadComponent: () => import('./pages/settings/settings.page').then((m) => m.SettingsPage),
  },
  {
    path: 'onboarding',
    loadComponent: () => import('./pages/onboarding/onboarding.page').then((m) => m.OnboardingPage),
  },
  { path: '**', redirectTo: 'dashboard' },
];
