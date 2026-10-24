# Troubleshooting

- **AI says "Not available":** start Ollama, `ollama list`, pick a model in Settings, *Check again*. The app works without AI.
- **"The model took too long":** use a smaller model or set parallel requests to 1; first request includes model load time.
- **"Destination already exists":** SlothFile never overwrites; edit the file name in the plan.
- **"File changed since plan":** rebuild the plan from the Files page.
- **Undo unavailable:** the file was edited/moved, or something now occupies the original location. Resolve manually.
- **After a crash:** the Dashboard lists what was reconciled; History shows entries marked *Interrupted* that need review.
- **App won't start, "database could not be opened":** another SlothFile instance may hold it, or the file is corrupt; back up `slothfile.db` from the data folder and remove it to start fresh (only metadata is lost).
- **Logs:** Settings → Your data shows the folder.
