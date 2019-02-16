# IP Camera Producer

Polls an IP camera's for an image, uploads the image to S3, and sends a message to the broker.

Uses a rolling window to keep number of files restricted.

### ToDos

- Validate manifest
  - Probably store partition numbers and sizes
- Handle if manifest is missing

### Notes

`docker-compose.override.yml` used to manage secrets for now.

### Possible Issues

- Unsure what will happen if the time it takes to clear a partition is longer than the polling interval. It may just miss a cycle.
