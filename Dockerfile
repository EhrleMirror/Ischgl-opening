FROM python:3.12-alpine
WORKDIR /app
COPY server.py ./
COPY public ./public
RUN mkdir -p /data && chown nobody:nobody /data
ENV PORT=8080 \
    DATA_FILE=/data/data.json
VOLUME /data
EXPOSE 8080
USER nobody
CMD ["python", "-u", "server.py"]
