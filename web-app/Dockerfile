FROM node:alpine

WORKDIR /web-app

COPY . .

RUN npm install

EXPOSE 3000

CMD [ "npm", "run", "dev" ]

