/** */
export const handler = async (): Promise<{ statusCode: number; body: string }> => {
  return {
    statusCode: 404,
    body: JSON.stringify({ error: 'not found' }),
  };
};
