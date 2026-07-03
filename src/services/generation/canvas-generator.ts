import * as path from "path"
import { CanvasContent, CanvasEdge, CanvasNode, Entity, Relation } from "../../types"
import { KnowledgeGraph } from "../graph/knowledge-graph"
import { getSubDir, safeFileName } from "../../utils"

const NODE_WIDTH = 300
const NODE_HEIGHT = 150
const START_X = 100
const START_Y = 100
const GAP_X = 400
const GAP_Y = 250
const MAX_NODES_OVERVIEW = 50

export class CanvasGenerator {
  constructor(
    private _nikelDir: string,
    private _vaultRelDir: string = "nikel",
  ) {}

  generateCluster(entityId: string, graph: KnowledgeGraph): CanvasContent {
    const cluster = graph.buildCluster(entityId, 1)
    const safeNameStr = safeFileName(
      graph.getEntity(entityId)?.name || entityId,
    )
    const filePath = path.join(this._nikelDir, "canvas", `кластер-${safeNameStr}.canvas`)

    const { nodes, edges } = this.layoutRadial(cluster.entities, cluster.relations, entityId)

    return { path: filePath, nodes, edges }
  }

  generateGlobalOverview(graph: KnowledgeGraph): CanvasContent {
    const filePath = path.join(this._nikelDir, "canvas", "обзор-базы-знаний.canvas")
    const entities = graph.entities.slice(0, MAX_NODES_OVERVIEW)
    const entityIds = new Set(entities.map((e) => e.id))
    const relations = graph.relations.filter(
      (r) => entityIds.has(r.from) && entityIds.has(r.to),
    )

    const { nodes, edges } = this.layoutGrid(entities, relations)

    return { path: filePath, nodes, edges }
  }

  generateTimeline(entities: Entity[], relations: Relation[]): CanvasContent {
    const filePath = path.join(this._nikelDir, "canvas", "хронология.canvas")

    const experiments = entities
      .filter((e) => e.type === "experiment")
      .sort((a, b) => {
        const dateA = a.properties?.date || a.createdAt
        const dateB = b.properties?.date || b.createdAt
        return dateA.localeCompare(dateB)
      })

    const nodes: CanvasNode[] = experiments.map((e, i) => ({
      id: e.id,
      x: START_X + i * GAP_X,
      y: START_Y,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      type: "file" as const,
      file: `${this._vaultRelDir}/experiments/${safeFileName(e.name)}.md`,
      label: e.name,
    }))

    const edges: CanvasEdge[] = []
    for (let i = 0; i < nodes.length - 1; i++) {
      edges.push({
        id: `timeline-${i}`,
        from: nodes[i].id,
        to: nodes[i + 1].id,
        label: "→",
        fromSide: "right",
        toSide: "left",
      })
    }

    return { path: filePath, nodes, edges }
  }

  private layoutRadial(
    entities: Entity[],
    relations: Relation[],
    centerId: string,
  ): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
    const centerEntity = entities.find((e) => e.id === centerId)
    if (!centerEntity) return this.layoutGrid(entities, relations)

    const nodes: CanvasNode[] = [
      this.entityToNode(centerEntity, 500, 300),
    ]

    const others = entities.filter((e) => e.id !== centerId)
    const angleStep = (2 * Math.PI) / Math.max(others.length, 1)

    others.forEach((entity, i) => {
      const angle = angleStep * i - Math.PI / 2
      const radius = 250
      const x = 500 + Math.cos(angle) * radius - NODE_WIDTH / 2
      const y = 300 + Math.sin(angle) * radius - NODE_HEIGHT / 2
      nodes.push(this.entityToNode(entity, x, y))
    })

    const edges: CanvasEdge[] = relations.map((r, i) => ({
      id: `edge-${i}`,
      from: r.from,
      to: r.to,
      label: r.context || r.type,
    }))

    return { nodes, edges }
  }

  private layoutGrid(
    entities: Entity[],
    relations: Relation[],
  ): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
    const cols = Math.ceil(Math.sqrt(entities.length))
    const nodes: CanvasNode[] = entities.map((entity, i) => {
      const col = i % cols
      const row = Math.floor(i / cols)
      return this.entityToNode(
        entity,
        START_X + col * GAP_X,
        START_Y + row * GAP_Y,
      )
    })

    const edges: CanvasEdge[] = relations.map((r, i) => ({
      id: `edge-${i}`,
      from: r.from,
      to: r.to,
      label: r.context || r.type,
    }))

    return { nodes, edges }
  }

  private entityToNode(entity: Entity, x: number, y: number): CanvasNode {
    const subDir = getSubDir(entity.type)
    return {
      id: entity.id,
      x: Math.round(x),
      y: Math.round(y),
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      type: "file",
      file: `${this._vaultRelDir}/${subDir}/${safeFileName(entity.name)}.md`,
      label: entity.name,
    }
  }

}
