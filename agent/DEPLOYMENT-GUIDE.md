# Sales & Funding Agent - Deployment Guide

Production deployment guide for the Sokogate automated sales and funding agent.

## Table of Contents

1. [Pre-Deployment Checklist](#pre-deployment-checklist)
2. [Environment Setup](#environment-setup)
3. [Docker Deployment](#docker-deployment)
4. [Cloud Deployment](#cloud-deployment)
5. [Monitoring & Alerting](#monitoring--alerting)
6. [Backup & Recovery](#backup--recovery)
7. [Scaling Strategies](#scaling-strategies)
8. [Security Hardening](#security-hardening)
9. [CI/CD Pipeline](#cicd-pipeline)
10. [Troubleshooting](#troubleshooting)

## Pre-Deployment Checklist

### Code Review
- [ ] All TypeScript compilation errors resolved
- [ ] Unit tests passing (>80% coverage)
- [ ] Integration tests passing
- [ ] Security audit completed
- [ ] Code review approved
- [ ] Documentation updated

### Infrastructure
- [ ] Production database provisioned
- [ ] Redis cluster configured
- [ ] Load balancer set up
- [ ] SSL certificates obtained
- [ ] DNS records configured
- [ ] Backup system tested

### Configuration
- [ ] Environment variables set
- [ ] API keys rotated for production
- [ ] Rate limits configured
- [ ] Monitoring enabled
- [ ] Logging configured
- [ ] Error tracking set up

### Testing
- [ ] Dry run mode tested
- [ ] Load testing completed
- [ ] Failover testing done
- [ ] Rollback procedure tested
- [ ] Disaster recovery tested

## Environment Setup

### Production Environment Variables

```bash
# Agent Configuration
AGENT_ENABLED=true
AGENT_DRY_RUN=false
AGENT_PORT=3000
NODE_ENV=production

# Database (use managed service)
DATABASE_URL=postgresql://user:pass@prod-db.example.com:5432/sokogate_agent
DATABASE_POOL_MIN=2
DATABASE_POOL_MAX=20
DATABASE_SSL=true

# Redis (use managed service)
REDIS_HOST=prod-redis.example.com
REDIS_PORT=6379
REDIS_PASSWORD=secure_password
REDIS_TLS=true

# Anthropic Claude AI
ANTHROPIC_API_KEY=sk-ant-prod-xxxxx
ANTHROPIC_MODEL=claude-3-5-sonnet-20241022
ANTHROPIC_MAX_TOKENS=4096

# Email (Resend)
RESEND_API_KEY=re_prod_xxxxx
RESEND_FROM_EMAIL=sales@sokogate.com
RESEND_FROM_NAME=Sokogate Sales Team

# WhatsApp Business API
WHATSAPP_ENABLED=true
WHATSAPP_API_URL=https://graph.facebook.com/v18.0
WHATSAPP_PHONE_NUMBER_ID=prod_phone_id
WHATSAPP_ACCESS_TOKEN=prod_access_token

# Calendly
CALENDLY_ENABLED=true
CALENDLY_API_KEY=prod_calendly_key
CALENDLY_EVENT_TYPE_UUID=prod_event_uuid

# Rate Limits (production values)
RATE_LIMIT_EMAIL_PER_DAY=500
RATE_LIMIT_WHATSAPP_PER_DAY=1000
RATE_LIMIT_CLAUDE_PER_MINUTE=50

# Monitoring
SENTRY_DSN=https://xxxxx@sentry.io/xxxxx
SENTRY_ENVIRONMENT=production
SENTRY_TRACES_SAMPLE_RATE=0.1

# Logging
LOG_LEVEL=info
LOG_FILE_ENABLED=true
LOG_FILE_PATH=/var/log/sokogate-agent
```

## Docker Deployment

### Dockerfile

```dockerfile
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY src ./src
COPY prompts ./prompts

# Build TypeScript
RUN npm run build

# Production image
FROM node:18-alpine

WORKDIR /app

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy built application
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/prompts ./prompts
COPY --chown=nodejs:nodejs package*.json ./

# Create logs directory
RUN mkdir -p /var/log/sokogate-agent && \
    chown -R nodejs:nodejs /var/log/sokogate-agent

USER nodejs

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

CMD ["node", "dist/index.js"]
```

### docker-compose.yml

```yaml
version: '3.8'

services:
  agent:
    build: .
    container_name: sokogate-agent
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=${DATABASE_URL}
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - RESEND_API_KEY=${RESEND_API_KEY}
    depends_on:
      - postgres
      - redis
    volumes:
      - ./logs:/var/log/sokogate-agent
    networks:
      - sokogate-network
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  postgres:
    image: postgres:14-alpine
    container_name: sokogate-postgres
    restart: unless-stopped
    environment:
      - POSTGRES_DB=sokogate_agent
      - POSTGRES_USER=${DB_USER}
      - POSTGRES_PASSWORD=${DB_PASSWORD}
    volumes:
      - postgres-data:/var/lib/postgresql/data
      - ./src/database/migrations:/docker-entrypoint-initdb.d
    networks:
      - sokogate-network
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER}"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    container_name: sokogate-redis
    restart: unless-stopped
    command: redis-server --appendonly yes
    volumes:
      - redis-data:/data
    networks:
      - sokogate-network
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  postgres-data:
  redis-data:

networks:
  sokogate-network:
    driver: bridge
```

### Build and Deploy

```bash
# Build image
docker build -t sokogate-agent:latest .

# Run with docker-compose
docker-compose up -d

# View logs
docker-compose logs -f agent

# Stop
docker-compose down

# Update and restart
docker-compose pull
docker-compose up -d --force-recreate
```

## Cloud Deployment

### AWS Deployment

#### Using ECS (Elastic Container Service)

1. **Push to ECR**:
```bash
# Authenticate
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <account-id>.dkr.ecr.us-east-1.amazonaws.com

# Tag and push
docker tag sokogate-agent:latest <account-id>.dkr.ecr.us-east-1.amazonaws.com/sokogate-agent:latest
docker push <account-id>.dkr.ecr.us-east-1.amazonaws.com/sokogate-agent:latest
```

2. **Create ECS Task Definition**:
```json
{
  "family": "sokogate-agent",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "1024",
  "memory": "2048",
  "containerDefinitions": [
    {
      "name": "agent",
      "image": "<account-id>.dkr.ecr.us-east-1.amazonaws.com/sokogate-agent:latest",
      "portMappings": [
        {
          "containerPort": 3000,
          "protocol": "tcp"
        }
      ],
      "environment": [
        {"name": "NODE_ENV", "value": "production"}
      ],
      "secrets": [
        {"name": "DATABASE_URL", "valueFrom": "arn:aws:secretsmanager:..."},
        {"name": "ANTHROPIC_API_KEY", "valueFrom": "arn:aws:secretsmanager:..."}
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/sokogate-agent",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "ecs"
        }
      },
      "healthCheck": {
        "command": ["CMD-SHELL", "curl -f http://localhost:3000/api/health || exit 1"],
        "interval": 30,
        "timeout": 5,
        "retries": 3
      }
    }
  ]
}
```

3. **Create ECS Service**:
```bash
aws ecs create-service \
  --cluster sokogate-cluster \
  --service-name sokogate-agent \
  --task-definition sokogate-agent \
  --desired-count 2 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-xxx],securityGroups=[sg-xxx],assignPublicIp=ENABLED}" \
  --load-balancers "targetGroupArn=arn:aws:elasticloadbalancing:...,containerName=agent,containerPort=3000"
```

#### Using RDS and ElastiCache

```bash
# Create RDS PostgreSQL instance
aws rds create-db-instance \
  --db-instance-identifier sokogate-agent-db \
  --db-instance-class db.t3.medium \
  --engine postgres \
  --engine-version 14.7 \
  --master-username admin \
  --master-user-password <password> \
  --allocated-storage 100 \
  --backup-retention-period 7 \
  --multi-az

# Create ElastiCache Redis cluster
aws elasticache create-cache-cluster \
  --cache-cluster-id sokogate-agent-redis \
  --cache-node-type cache.t3.medium \
  --engine redis \
  --num-cache-nodes 1 \
  --engine-version 7.0
```

### Google Cloud Platform (GCP)

#### Using Cloud Run

```bash
# Build and push to GCR
gcloud builds submit --tag gcr.io/PROJECT_ID/sokogate-agent

# Deploy to Cloud Run
gcloud run deploy sokogate-agent \
  --image gcr.io/PROJECT_ID/sokogate-agent \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --memory 2Gi \
  --cpu 2 \
  --min-instances 1 \
  --max-instances 10 \
  --set-env-vars NODE_ENV=production \
  --set-secrets DATABASE_URL=sokogate-db-url:latest,ANTHROPIC_API_KEY=anthropic-key:latest
```

#### Using Cloud SQL and Memorystore

```bash
# Create Cloud SQL instance
gcloud sql instances create sokogate-agent-db \
  --database-version=POSTGRES_14 \
  --tier=db-custom-2-7680 \
  --region=us-central1 \
  --backup \
  --backup-start-time=03:00

# Create Memorystore Redis instance
gcloud redis instances create sokogate-agent-redis \
  --size=5 \
  --region=us-central1 \
  --redis-version=redis_7_0
```

### Azure Deployment

#### Using Container Instances

```bash
# Create resource group
az group create --name sokogate-rg --location eastus

# Create container registry
az acr create --resource-group sokogate-rg --name sokogateacr --sku Basic

# Push image
az acr build --registry sokogateacr --image sokogate-agent:latest .

# Deploy container
az container create \
  --resource-group sokogate-rg \
  --name sokogate-agent \
  --image sokogateacr.azurecr.io/sokogate-agent:latest \
  --cpu 2 \
  --memory 4 \
  --registry-login-server sokogateacr.azurecr.io \
  --registry-username <username> \
  --registry-password <password> \
  --environment-variables NODE_ENV=production \
  --secure-environment-variables DATABASE_URL=<url> ANTHROPIC_API_KEY=<key> \
  --ports 3000
```

## Monitoring & Alerting

### Sentry Integration

Already configured in the code. Ensure `SENTRY_DSN` is set in production.

### CloudWatch/Stackdriver Logs

```bash
# AWS CloudWatch
aws logs create-log-group --log-group-name /ecs/sokogate-agent

# GCP Stackdriver
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=sokogate-agent"
```

### Prometheus Metrics

Add to `src/index.ts`:

```typescript
import promClient from 'prom-client';

const register = new promClient.Registry();
promClient.collectDefaultMetrics({ register });

// Custom metrics
const messagesSent = new promClient.Counter({
  name: 'agent_messages_sent_total',
  help: 'Total messages sent',
  labelNames: ['channel', 'type'],
  registers: [register]
});

// Expose metrics endpoint
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});
```

### Grafana Dashboard

Create dashboard with:
- Messages sent per hour
- Response rate
- Escalation rate
- API latency
- Error rate
- Rate limit usage

## Backup & Recovery

### Database Backups

```bash
# Automated daily backups
0 2 * * * pg_dump $DATABASE_URL | gzip > /backups/sokogate-$(date +\%Y\%m\%d).sql.gz

# Restore from backup
gunzip -c /backups/sokogate-20260515.sql.gz | psql $DATABASE_URL
```

### Redis Persistence

Configure in `redis.conf`:
```
appendonly yes
appendfsync everysec
save 900 1
save 300 10
save 60 10000
```

### Disaster Recovery Plan

1. **RTO (Recovery Time Objective)**: 1 hour
2. **RPO (Recovery Point Objective)**: 15 minutes
3. **Backup Strategy**:
   - Database: Continuous replication + daily snapshots
   - Redis: AOF persistence + hourly snapshots
   - Logs: Real-time streaming to S3/GCS
4. **Failover Procedure**:
   - Automated health checks
   - Auto-scaling on failure
   - Multi-region deployment for critical services

## Scaling Strategies

### Horizontal Scaling

```bash
# AWS ECS
aws ecs update-service \
  --cluster sokogate-cluster \
  --service sokogate-agent \
  --desired-count 5

# GCP Cloud Run (auto-scales)
gcloud run services update sokogate-agent \
  --min-instances 2 \
  --max-instances 20
```

### Vertical Scaling

```bash
# Increase container resources
# Update task definition with higher CPU/memory
# Redeploy service
```

### Database Scaling

- **Read Replicas**: For read-heavy workloads
- **Connection Pooling**: Already implemented (max 20 connections)
- **Query Optimization**: Use EXPLAIN ANALYZE
- **Partitioning**: For large tables (>10M rows)

### Redis Scaling

- **Cluster Mode**: For >100GB data
- **Read Replicas**: For read-heavy workloads
- **Eviction Policy**: `allkeys-lru` for cache

## Security Hardening

### Network Security

```bash
# Restrict database access
# Only allow connections from agent IPs
# Use VPC/VNet for isolation
# Enable SSL/TLS for all connections
```

### Secrets Management

```bash
# AWS Secrets Manager
aws secretsmanager create-secret \
  --name sokogate/agent/anthropic-key \
  --secret-string "sk-ant-xxxxx"

# GCP Secret Manager
echo -n "sk-ant-xxxxx" | gcloud secrets create anthropic-key --data-file=-

# Azure Key Vault
az keyvault secret set \
  --vault-name sokogate-vault \
  --name anthropic-key \
  --value "sk-ant-xxxxx"
```

### API Security

- Rate limiting (already implemented)
- API key authentication
- CORS configuration
- Input validation
- SQL injection prevention (using parameterized queries)

### Compliance

- GDPR: Data retention policies
- CCPA: User data deletion
- SOC 2: Audit logging
- ISO 27001: Security controls

## CI/CD Pipeline

### GitHub Actions

```yaml
name: Deploy Agent

on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 18
      - run: npm ci
      - run: npm test
      - run: npm run build

  deploy:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v2
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1
      - name: Login to ECR
        run: aws ecr get-login-password | docker login --username AWS --password-stdin ${{ secrets.ECR_REGISTRY }}
      - name: Build and push
        run: |
          docker build -t sokogate-agent .
          docker tag sokogate-agent:latest ${{ secrets.ECR_REGISTRY }}/sokogate-agent:latest
          docker push ${{ secrets.ECR_REGISTRY }}/sokogate-agent:latest
      - name: Deploy to ECS
        run: |
          aws ecs update-service --cluster sokogate-cluster --service sokogate-agent --force-new-deployment
```

## Troubleshooting

### High Memory Usage

```bash
# Check memory
docker stats sokogate-agent

# Increase memory limit
# Update task definition or docker-compose
```

### Database Connection Issues

```bash
# Check connections
SELECT count(*) FROM pg_stat_activity;

# Kill idle connections
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = 'idle';
```

### Rate Limit Exceeded

```bash
# Check current usage
curl http://localhost:3000/api/status

# Increase limits in .env
RATE_LIMIT_EMAIL_PER_DAY=1000
```

### Slow Response Times

```bash
# Check database queries
SELECT query, mean_exec_time FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10;

# Add indexes
CREATE INDEX idx_conversations_contact ON conversations(contact_id);
```

## Rollback Procedure

```bash
# AWS ECS
aws ecs update-service \
  --cluster sokogate-cluster \
  --service sokogate-agent \
  --task-definition sokogate-agent:PREVIOUS_VERSION

# Docker
docker-compose down
docker-compose up -d --force-recreate sokogate-agent:previous-tag

# Verify
curl http://localhost:3000/api/health
```

## Post-Deployment Checklist

- [ ] Health check passing
- [ ] Logs streaming correctly
- [ ] Metrics being collected
- [ ] Alerts configured
- [ ] Backups running
- [ ] SSL certificate valid
- [ ] DNS resolving correctly
- [ ] Rate limits appropriate
- [ ] Team notified
- [ ] Documentation updated

## Support Contacts

- **DevOps**: devops@sokogate.com
- **On-Call**: +254-XXX-XXXXXX
- **Slack**: #sokogate-agent-alerts
- **PagerDuty**: https://sokogate.pagerduty.com

## Additional Resources

- [AWS ECS Best Practices](https://docs.aws.amazon.com/AmazonECS/latest/bestpracticesguide/)
- [GCP Cloud Run Documentation](https://cloud.google.com/run/docs)
- [Docker Security Best Practices](https://docs.docker.com/engine/security/)
- [PostgreSQL Performance Tuning](https://wiki.postgresql.org/wiki/Performance_Optimization)

# Made with Bob
