FROM node:5.11.0
MAINTAINER Jonathan Gros-Dubois

LABEL version="4.5.0"
LABEL description="Docker file for SocketCluster"

RUN mkdir -p /usr/src/
WORKDIR /usr/src/
COPY . /usr/src/

RUN npm install .

EXPOSE 8000

CMD ["npm", "start"]
