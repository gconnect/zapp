import swaggerJsDoc from 'swagger-jsdoc';

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Zapp API',
      version: '1.0.0',
      description: 'API Documentation for the Zapp Conversational Payments Backend',
    },
    servers: [
      {
        url: 'https://zapp.africinnovate.com',
        description: 'Production Server',
      },
      {
        url: 'http://localhost:{port}',
        description: 'Local Development Server',
        variables: {
          port: {
            default: '5500'
          }
        }
      },
    ],
  },
  apis: ['./routes/*.js'], // Path to the API routes
};

export const swaggerSpec = swaggerJsDoc(options);
