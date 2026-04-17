import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Gift, Zap, TrendingUp } from 'lucide-react';

export default function LoyaltyRewards() {
  const [user, setUser] = useState(null);
  const [customerLoyalty, setCustomerLoyalty] = useState(null);

  useEffect(() => {
    base44.auth.me().then(u => {
      setUser(u);
      fetchCustomerLoyalty(u.email);
    });
  }, []);

  const fetchCustomerLoyalty = async (email) => {
    try {
      const results = await base44.entities.CustomerLoyalty.filter({ customer_email: email });
      if (results && results.length > 0) {
        setCustomerLoyalty(results[0]);
      }
    } catch (error) {
      console.error('Error fetching loyalty data:', error);
    }
  };

  const { data: rewards = [] } = useQuery({
    queryKey: ['rewards'],
    queryFn: () => base44.entities.Rewards.filter({ is_active: true }),
  });

  const availableRewards = rewards.filter(r => 
    customerLoyalty && r.points_required <= customerLoyalty.total_points
  );

  const nextReward = rewards
    .filter(r => customerLoyalty && r.points_required > customerLoyalty.total_points)
    .sort((a, b) => a.points_required - b.points_required)[0];

  const pointsToNextReward = nextReward 
    ? nextReward.points_required - (customerLoyalty?.total_points || 0)
    : null;

  if (!customerLoyalty) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">No loyalty data found</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Current Points</p>
                <p className="text-3xl font-bold mt-2">{customerLoyalty.total_points}</p>
              </div>
              <Zap className="w-8 h-8 text-yellow-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Lifetime Points</p>
                <p className="text-3xl font-bold mt-2">{customerLoyalty.lifetime_points}</p>
              </div>
              <TrendingUp className="w-8 h-8 text-green-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Redeemed</p>
                <p className="text-3xl font-bold mt-2">{customerLoyalty.redeemed_points}</p>
              </div>
              <Gift className="w-8 h-8 text-pink-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Progress to Next Reward */}
      {nextReward && (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader>
            <CardTitle className="text-lg">Next Reward</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="flex justify-between mb-2">
                <span className="font-medium">{nextReward.title}</span>
                <span className="text-sm text-muted-foreground">{pointsToNextReward} points to go</span>
              </div>
              <div className="w-full bg-secondary rounded-full h-2">
                <div 
                  className="bg-primary h-2 rounded-full transition-all"
                  style={{ width: `${(customerLoyalty.total_points / nextReward.points_required) * 100}%` }}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Available Rewards */}
      {availableRewards.length > 0 && (
        <div>
          <h2 className="text-2xl font-bold mb-4">🎁 Available Rewards</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {availableRewards.map(reward => (
              <Card key={reward.id} className="border-green-200 bg-green-50">
                <CardHeader>
                  <div className="flex justify-between items-start">
                    <CardTitle className="text-lg">{reward.title}</CardTitle>
                    <Badge className="bg-green-600">{reward.points_required} pts</Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-3">{reward.description}</p>
                  <div className="flex justify-between items-center">
                    <span className="text-xs bg-white px-2 py-1 rounded">{reward.reward_type.replace('_', ' ')}</span>
                    <span className="text-2xl">{reward.icon}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Upcoming Rewards */}
      <div>
        <h2 className="text-2xl font-bold mb-4">🏆 Unlock These Rewards</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {rewards
            .filter(r => r.points_required > customerLoyalty.total_points)
            .sort((a, b) => a.points_required - b.points_required)
            .slice(0, 4)
            .map(reward => (
              <Card key={reward.id} className="opacity-60">
                <CardHeader>
                  <div className="flex justify-between items-start">
                    <CardTitle className="text-lg">{reward.title}</CardTitle>
                    <Badge variant="outline">{reward.points_required} pts</Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{reward.description}</p>
                  <p className="text-xs text-primary mt-2 font-medium">
                    {reward.points_required - customerLoyalty.total_points} points away
                  </p>
                </CardContent>
              </Card>
            ))}
        </div>
      </div>

      {/* Points History */}
      {customerLoyalty.points_history && customerLoyalty.points_history.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>📊 Points History</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {customerLoyalty.points_history.slice(-10).reverse().map((entry, i) => (
                <div key={i} className="flex justify-between items-center p-3 bg-muted rounded-lg">
                  <div>
                    <p className="font-medium capitalize">{entry.type}</p>
                    <p className="text-sm text-muted-foreground">{entry.description}</p>
                  </div>
                  <span className={`font-bold ${entry.type === 'earned' || entry.type === 'bonus' ? 'text-green-600' : 'text-red-600'}`}>
                    {entry.type === 'redeemed' ? '-' : '+'}{entry.amount}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}