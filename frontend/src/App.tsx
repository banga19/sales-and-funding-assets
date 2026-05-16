import React, { useState, useEffect } from 'react';
import { Activity, Database, Mail, MessageSquare, Bot, AlertCircle, CheckCircle, XCircle } from 'lucide-react';
import { apiClient } from './api/client';
import { HealthCheck, AgentStatus } from './types';
import './App.css';

function App() {
  const [health, setHealth] = useState<HealthCheck | null>(null);
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const [healthData, statusData] = await Promise.all([
        apiClient.getHealth(),
        apiClient.getStatus(),
      ]);
      
      setHealth(healthData);
      setStatus(statusData);
      setLastUpdate(new Date());
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Failed to fetch data');
      console.error('Error fetching data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchData, 30000);
    
    return () => clearInterval(interval);
  }, []);

  const getStatusIcon = (healthy: boolean) => {
    return healthy ? (
      <CheckCircle className="w-5 h-5 text-green-500" />
    ) : (
      <XCircle className="w-5 h-5 text-red-500" />
    );
  };

  const getStatusBadge = (healthy: boolean) => {
    return (
      <span className={`px-2 py-1 rounded text-xs font-semibold ${
        healthy ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
      }`}>
        {healthy ? 'Healthy' : 'Unhealthy'}
      </span>
    );
  };

  if (loading && !health) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Activity className="w-12 h-12 text-blue-500 animate-spin mx-auto mb-4" />
          <p className="text-gray-600">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (error && !health) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white p-8 rounded-lg shadow-lg max-w-md">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-gray-900 mb-2 text-center">Connection Error</h2>
          <p className="text-gray-600 mb-4 text-center">{error}</p>
          <button
            onClick={fetchData}
            className="w-full bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 transition"
          >
            Retry Connection
          </button>
          <div className="mt-4 p-4 bg-gray-50 rounded text-sm">
            <p className="font-semibold mb-2">Troubleshooting:</p>
            <ul className="list-disc list-inside space-y-1 text-gray-600">
              <li>Verify backend is running on port 3000</li>
              <li>Check REACT_APP_API_URL in .env</li>
              <li>Ensure CORS is configured</li>
            </ul>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <Bot className="w-8 h-8 text-blue-500" />
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Sokogate Sales & Funding Agent</h1>
                <p className="text-sm text-gray-500">AI-Powered Sales Automation Dashboard</p>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <div className="text-right">
                <p className="text-xs text-gray-500">Last Updated</p>
                <p className="text-sm font-medium text-gray-700">
                  {lastUpdate.toLocaleTimeString()}
                </p>
              </div>
              <button
                onClick={fetchData}
                disabled={loading}
                className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 transition disabled:opacity-50"
              >
                {loading ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* System Health Overview */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">System Health</h2>
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center space-x-3">
                <Activity className="w-6 h-6 text-gray-600" />
                <span className="text-xl font-semibold text-gray-900">Overall Status</span>
              </div>
              {health && getStatusBadge(health.status === 'healthy')}
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Database */}
              <div className="p-4 border border-gray-200 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <Database className="w-5 h-5 text-gray-600" />
                    <span className="font-medium text-gray-900">Database</span>
                  </div>
                  {health && getStatusIcon(health.checks.database.healthy)}
                </div>
                {health?.checks.database.error && (
                  <p className="text-xs text-red-600 mt-1">{health.checks.database.error}</p>
                )}
              </div>

              {/* Email */}
              <div className="p-4 border border-gray-200 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <Mail className="w-5 h-5 text-gray-600" />
                    <span className="font-medium text-gray-900">Email Service</span>
                  </div>
                  {health && getStatusIcon(health.checks.email)}
                </div>
              </div>

              {/* WhatsApp */}
              <div className="p-4 border border-gray-200 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <MessageSquare className="w-5 h-5 text-gray-600" />
                    <span className="font-medium text-gray-900">WhatsApp</span>
                  </div>
                  {health && getStatusIcon(health.checks.whatsapp)}
                </div>
                {!health?.checks.whatsapp && (
                  <p className="text-xs text-gray-500 mt-1">Configure credentials in .env</p>
                )}
              </div>

              {/* Claude AI */}
              <div className="p-4 border border-gray-200 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <Bot className="w-5 h-5 text-gray-600" />
                    <span className="font-medium text-gray-900">Claude AI</span>
                  </div>
                  {health && getStatusIcon(health.checks.claude)}
                </div>
                {!health?.checks.claude && (
                  <p className="text-xs text-gray-500 mt-1">Add API credits</p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Agent Status */}
        {status && (
          <div className="mb-8">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Agent Configuration</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Agent Settings */}
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="font-semibold text-gray-900 mb-4">Settings</h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-600">Agent Enabled</span>
                    <span className={`px-2 py-1 rounded text-xs font-semibold ${
                      status.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                    }`}>
                      {status.enabled ? 'Yes' : 'No'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-600">Dry Run Mode</span>
                    <span className={`px-2 py-1 rounded text-xs font-semibold ${
                      status.dryRun ? 'bg-yellow-100 text-yellow-800' : 'bg-blue-100 text-blue-800'
                    }`}>
                      {status.dryRun ? 'Yes' : 'No'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Rate Limits */}
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="font-semibold text-gray-900 mb-4">Rate Limits (Today)</h3>
                <div className="space-y-4">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-gray-600">Email</span>
                      <span className="text-sm font-medium">
                        {status.rateLimits.email.remaining}/{status.rateLimits.email.limit}
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-blue-500 h-2 rounded-full"
                        style={{
                          width: `${(status.rateLimits.email.remaining / status.rateLimits.email.limit) * 100}%`
                        }}
                      ></div>
                    </div>
                  </div>
                  
                  {status.rateLimits.whatsapp && (
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-gray-600">WhatsApp</span>
                        <span className="text-sm font-medium">
                          {status.rateLimits.whatsapp.remaining}/{status.rateLimits.whatsapp.limit}
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                          className="bg-green-500 h-2 rounded-full"
                          style={{
                            width: `${(status.rateLimits.whatsapp.remaining / status.rateLimits.whatsapp.limit) * 100}%`
                          }}
                        ></div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Features */}
        {status && (
          <div className="mb-8">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Feature Status</h2>
            <div className="bg-white rounded-lg shadow p-6">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {Object.entries(status.features).map(([feature, enabled]) => (
                  <div key={feature} className="flex items-center justify-between p-3 border border-gray-200 rounded">
                    <span className="text-gray-700 capitalize">
                      {feature.replace(/([A-Z])/g, ' $1').trim()}
                    </span>
                    <span className={`px-2 py-1 rounded text-xs font-semibold ${
                      enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                    }`}>
                      {enabled ? 'On' : 'Off'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Quick Actions */}
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h2>
          <div className="bg-white rounded-lg shadow p-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <button className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition text-left">
                <div className="flex items-center space-x-3 mb-2">
                  <Mail className="w-5 h-5 text-blue-500" />
                  <span className="font-medium text-gray-900">Send Test Email</span>
                </div>
                <p className="text-sm text-gray-600">Test email service configuration</p>
              </button>
              
              <button className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition text-left">
                <div className="flex items-center space-x-3 mb-2">
                  <Activity className="w-5 h-5 text-green-500" />
                  <span className="font-medium text-gray-900">View Logs</span>
                </div>
                <p className="text-sm text-gray-600">Check recent agent activity</p>
              </button>
              
              <button className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition text-left">
                <div className="flex items-center space-x-3 mb-2">
                  <Database className="w-5 h-5 text-purple-500" />
                  <span className="font-medium text-gray-900">View Contacts</span>
                </div>
                <p className="text-sm text-gray-600">Manage prospects and leads</p>
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;

// Made with Bob
