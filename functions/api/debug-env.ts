/** 임시 진단용 — 환경변수 키 목록만 반환 (값 노출 없음) */
export const onRequestGet: PagesFunction = async (context) => {
  const keys = Object.keys(context.env || {});
  const hasKling = !!((context.env as Record<string, string>)["KLING_API_KEY"]);
  const klingKeyLen = ((context.env as Record<string, string>)["KLING_API_KEY"] ?? "").length;

  return Response.json({
    envKeys: keys,
    hasKling,
    klingKeyLen,
  });
};
