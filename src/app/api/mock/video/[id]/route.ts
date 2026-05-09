export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return Response.json({
    id,
    mock: true,
    message: "This endpoint stands in for a generated video file until Seedance 2 or HappyHorse is connected.",
  });
}
