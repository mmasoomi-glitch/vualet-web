# Install Mira Reconciliation Sweep

This fixes finding 1b: the reconciliation sweep is the documented
fallback for missed webhooks, but it was never scheduled. These
systemd units schedule it hourly.

## Install
```bash
sudo cp deploy/mira-reconcile.service deploy/mira-reconcile.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now mira-reconcile.timer
```

## Verify
```bash
systemctl list-timers mira-reconcile.timer
journalctl -u mira-reconcile -n 50
```

## Caveat
Check `WorkingDirectory` and `EnvironmentFile` in the `.service` file
against the real `mira-web` unit before installing.
