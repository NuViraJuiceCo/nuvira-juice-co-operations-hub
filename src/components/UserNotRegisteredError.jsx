import React from 'react';
import { base44 } from '@/api/base44Client';

const UserNotRegisteredError = () => {
  const handleCompleteSignup = () => {
    // Log out current partial session and redirect through login flow
    // This allows the platform to complete account registration
    base44.auth.logout(window.location.href);
  };

  const handleSignOut = () => {
    base44.auth.logout();
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-b from-slate-50 to-white px-4">
      <div className="max-w-md w-full p-8 bg-white rounded-2xl shadow-lg border border-slate-200">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 mb-6 rounded-full bg-amber-100">
            <svg className="w-8 h-8 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>

          <h1 className="text-2xl font-bold text-slate-900 mb-2">Account Setup Incomplete</h1>
          <p className="text-slate-600 mb-6 text-sm leading-relaxed">
            Your account hasn't been fully set up yet. This can happen when an invite link doesn't complete the sign-up process. Click below to sign out and sign back in — this will finish creating your account.
          </p>

          <div className="space-y-3">
            <button
              onClick={handleCompleteSignup}
              className="w-full bg-green-700 hover:bg-green-800 text-white font-semibold py-3 px-6 rounded-lg transition-colors text-sm"
            >
              Sign Out & Complete Setup
            </button>
            <button
              onClick={handleSignOut}
              className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium py-3 px-6 rounded-lg transition-colors text-sm"
            >
              Sign Out
            </button>
          </div>

          <div className="mt-6 p-4 bg-slate-50 rounded-lg text-xs text-slate-500 text-left space-y-1">
            <p className="font-semibold text-slate-600">Troubleshooting tips:</p>
            <ul className="list-disc list-inside space-y-1 mt-1">
              <li>Use the same email address your invite was sent to</li>
              <li>If you haven't set a password yet, use the invite link from your email again</li>
              <li>Contact <span className="font-medium">admin@nuvirajuice.com</span> if the issue persists</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UserNotRegisteredError;