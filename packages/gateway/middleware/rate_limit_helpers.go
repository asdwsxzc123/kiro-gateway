package middleware

import "github.com/redis/go-redis/v9"

// newZMember creates a redis.Z sorted set member.
func newZMember(score float64, member string) redis.Z {
	return redis.Z{
		Score:  score,
		Member: member,
	}
}
