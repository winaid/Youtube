"use client";

import { useState, useEffect } from "react";
import { SeriesProject, CharacterSeed } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  loadSeriesProjects,
  createSeriesProject,
  addEpisodeToSeries,
  deleteSeriesProject,
} from "@/lib/series-manager";

interface SeriesManagerProps {
  characterSeeds: CharacterSeed[];
  projectTitle: string;
  onLoadCharacters?: (characters: CharacterSeed[]) => void;
}

export default function SeriesManager({
  characterSeeds,
  projectTitle,
  onLoadCharacters,
}: SeriesManagerProps) {
  const [projects, setProjects] = useState<SeriesProject[]>([]);
  const [newTitle, setNewTitle] = useState("");
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setProjects(loadSeriesProjects());
  }, []);

  const handleCreate = () => {
    if (!newTitle.trim()) return;
    const p = createSeriesProject(newTitle.trim());
    setProjects((prev) => [...prev, p]);
    setNewTitle("");
  };

  const handleSaveEpisode = (seriesId: string) => {
    const ep = addEpisodeToSeries(seriesId, {
      title: projectTitle,
      characterSeeds,
      worldSetting: "",
    });
    if (ep) {
      setProjects(loadSeriesProjects());
    }
  };

  const handleDelete = (seriesId: string) => {
    if (!confirm("시리즈를 삭제하시겠습니까?")) return;
    deleteSeriesProject(seriesId);
    setProjects(loadSeriesProjects());
  };

  const handleLoadChars = (seriesId: string) => {
    const project = projects.find((p) => p.id === seriesId);
    if (project && onLoadCharacters) {
      onLoadCharacters(project.sharedCharacters);
    }
  };

  return (
    <Card className="overflow-hidden border-2" style={{ borderColor: "#6b5ce740" }}>
      <CardHeader
        className="pb-2 cursor-pointer"
        style={{ background: "linear-gradient(135deg, #6b5ce715, #787fff10)" }}
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm" style={{ color: "#6b5ce7" }}>
            시리즈 연속성 관리
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px]" style={{ borderColor: "#6b5ce7" }}>
              {projects.length}개 시리즈
            </Badge>
            <span className="text-xs text-muted-foreground">{expanded ? "▲" : "▼"}</span>
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="space-y-3 pt-3">
          <p className="text-[10px] text-muted-foreground">
            에피소드 간 캐릭터/세계관을 자동으로 이어갑니다. 이전 에피소드의 캐릭터 시드를 불러올 수 있습니다.
          </p>

          {/* 새 시리즈 생성 */}
          <div className="flex gap-2">
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="새 시리즈 제목..."
              className="flex-1 h-8 rounded-md border text-xs px-2 focus:ring-1 focus:ring-[#6b5ce7] focus:outline-none"
            />
            <Button
              size="sm"
              className="text-xs text-white"
              style={{ background: "#6b5ce7" }}
              onClick={handleCreate}
              disabled={!newTitle.trim()}
            >
              생성
            </Button>
          </div>

          {/* 시리즈 목록 */}
          {projects.map((project) => (
            <div
              key={project.id}
              className="p-2.5 rounded-lg space-y-2"
              style={{ background: "#6b5ce708", border: "1px solid #6b5ce715" }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium">{project.seriesTitle}</span>
                  <Badge className="text-[9px] text-white" style={{ background: "#6b5ce7" }}>
                    {project.episodes.length}화
                  </Badge>
                  <Badge variant="outline" className="text-[9px]" style={{ borderColor: "#e09900" }}>
                    캐릭터 {project.sharedCharacters.length}명
                  </Badge>
                </div>
                <button
                  onClick={() => handleDelete(project.id)}
                  className="text-[10px] text-red-400 hover:text-red-600"
                >
                  삭제
                </button>
              </div>

              {/* 에피소드 목록 */}
              {project.episodes.length > 0 && (
                <div className="space-y-1">
                  {project.episodes.map((ep) => (
                    <div key={ep.id} className="text-[10px] flex items-center gap-2 px-2 py-1 rounded" style={{ background: "#fff" }}>
                      <span style={{ color: "#6b5ce7" }}>EP{ep.episodeNumber}</span>
                      <span className="text-muted-foreground">{ep.title}</span>
                      <span className="text-muted-foreground ml-auto">
                        {new Date(ep.createdAt).toLocaleDateString("ko")}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  className="text-[10px] h-6 text-white"
                  style={{ background: "#6b5ce7" }}
                  onClick={() => handleSaveEpisode(project.id)}
                >
                  현재 에피소드 저장
                </Button>
                {project.sharedCharacters.length > 0 && onLoadCharacters && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-[10px] h-6"
                    style={{ borderColor: "#e09900", color: "#e09900" }}
                    onClick={() => handleLoadChars(project.id)}
                  >
                    캐릭터 불러오기
                  </Button>
                )}
              </div>
            </div>
          ))}

          {projects.length === 0 && (
            <p className="text-[10px] text-center text-muted-foreground py-2">
              아직 시리즈가 없습니다. 위에서 새 시리즈를 생성하세요.
            </p>
          )}
        </CardContent>
      )}
    </Card>
  );
}
