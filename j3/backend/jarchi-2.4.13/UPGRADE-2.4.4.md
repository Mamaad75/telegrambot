# Upgrade to Jarchi 2.4.4

This release is schema-compatible with 2.4.1/2.4.3 and adds no migration file.

Recommended production sequence:

```bash
cd /var/www
cp -a jarchi "jarchi-backup-$(date +%Y%m%d-%H%M%S)"
# extract/copy the 2.4.4 package into /var/www/jarchi while preserving .env
cd /var/www/jarchi
npm install --omit=dev
npm run db:status
pm2 restart jarchi --update-env
curl -fsS http://127.0.0.1:3002/health
curl -fsS http://127.0.0.1:3002/health/ready
pm2 logs jarchi --lines 80 --nostream
```

Expected health version: `2.4.4`.

For the standard local Nginx -> `127.0.0.1:3002` topology, no new environment value is required: production defaults to trusting loopback only. Keep these Nginx headers:

```nginx
proxy_set_header X-Real-IP         $remote_addr;
proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
```

`/var/www/telegram-publisher-v2` is a separate application and is not part of this package.
