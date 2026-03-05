# MongoDB: How to connect and see how data is stored

The daemon stores **notification config** (webhooks, email, thresholds) in MongoDB. Use these commands from your laptop to connect and run queries.

---

## Step 1: Port-forward MongoDB (run in a terminal and leave it open)

MongoDB runs in the `mongo` namespace. Forward the service so you can connect from your machine:

```bash
kubectl port-forward -n mongo svc/mongo 27017:27017
```

If port 27017 is already in use, use another local port and forward a single pod:

```bash
kubectl port-forward -n mongo pod/mongo-0 27018:27017
```

(Use `27018` in the connection strings below if you used this second command.)

---

## Step 2: Connect with mongosh

**If you used the first port-forward (27017):**

```bash
mongosh "mongodb://localhost:27017/kerneleye?directConnection=true"
```

**If you used pod mongo-0 on 27018:**

```bash
mongosh "mongodb://127.0.0.1:27018/kerneleye?directConnection=true"
```

---

## Step 3: Queries to see how data is stored

Once inside `mongosh` (you’ll see `kerneleye>`), run:

### Use the database

```javascript
use kerneleye
```

### List all collections

```javascript
show collections
```

You should see at least:
- `extension_notification_config` – notification extension (webhooks, email, thresholds)

### See notification config (webhooks, email, thresholds)

```javascript
db.extension_notification_config.find().pretty()
```

One document with `key: "default"` holds the full config. Fields include:
- `config.enabled` – notifications on/off  
- `config.interval_seconds` – check interval  
- `config.webhooks` – array of { type, url, enabled }  
- `config.thresholds` – array of { metric_type, level, threshold_value, node_name, pod_name }  
- `config.email_enabled`, `config.smtp_host`, `config.smtp_port`, `config.email_from`, `config.email_to`, `config.smtp_username`, `config.smtp_password` (email settings)  
- `updated_at` – last save time  

### See only the config object (no key/updated_at)

```javascript
db.extension_notification_config.findOne(
  { key: "default" },
  { config: 1, updated_at: 1, _id: 0 }
)
```

### Count documents in the collection

```javascript
db.extension_notification_config.countDocuments()
```

---

## One-liner (no interactive mongosh)

Port-forward in one terminal, then in another terminal run:

```bash
mongosh "mongodb://localhost:27017/kerneleye?directConnection=true" --eval 'db.extension_notification_config.find().pretty()db.extension_notification_config.find().pretty()'
```

Or to print only the `config` field:

```bash
mongosh "mongodb://localhost:27017/kerneleye?directConnection=true" --eval 'db.extension_notification_config.findOne({key:"default"},{config:1,updated_at:1,_id:0})'
```

---

## Summary: where notification data is stored

| What              | Database   | Collection                      | Document      |
|-------------------|------------|----------------------------------|---------------|
| Notification config | `kerneleye` | `extension_notification_config` | One doc with `key: "default"`; full config in `config` |

The daemon reads/writes this via `EXTENSION_MONGO_URI` or `MONGODB_URI`; default DB is `kerneleye`, default collection is `extension_notification_config`.
