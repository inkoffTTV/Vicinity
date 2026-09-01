import QtQuick 2.15
import QtQuick.Shapes 1.15

// Рендер градиента по спецификации:
//   { type: "linear"|"radial", angle: <deg>, stops: [{pos:0..1, color:"#.."}, ...] }
// Линейный — с произвольным углом, радиальный — из центра. До 4 стопов.
Item {
    id: root
    property var spec: ({ type: "linear", angle: 90,
                          stops: [{pos:0, color:"#5865f2"}, {pos:1, color:"#eb459e"}] })
    property real radius: 0

    readonly property bool _isRadial: spec && spec.type === "radial"
    readonly property real _angle: spec && spec.angle !== undefined ? spec.angle : 90

    // Нормализуем стопы до ровно 4 (хвост дублируем) и сортируем
    function _norm() {
        var st = (spec && spec.stops && spec.stops.length > 0)
                 ? spec.stops.slice()
                 : [{pos:0, color:"#5865f2"}, {pos:1, color:"#eb459e"}]
        st = st.map(function(s){ return { pos: Math.max(0, Math.min(1, s.pos)), color: s.color } })
        st.sort(function(a,b){ return a.pos - b.pos })
        while (st.length < 4) st.push({ pos: 1, color: st[st.length-1].color })
        return st
    }
    property var _stops: _norm()
    onSpecChanged: _stops = _norm()

    // Конечные точки линейного градиента из угла (0°=→, 90°=↓)
    readonly property real _r: _angle * Math.PI / 180
    readonly property real _dx: Math.cos(_r)
    readonly property real _dy: Math.sin(_r)
    readonly property real _L: (Math.abs(_dx) * width + Math.abs(_dy) * height) / 2

    Shape {
        anchors.fill: parent
        antialiasing: true
        preferredRendererType: Shape.CurveRenderer
        layer.enabled: root.radius > 0
        layer.effect: null

        ShapePath {
            strokeColor: "transparent"
            fillGradient: root._isRadial ? radGrad : linGrad
            startX: 0; startY: 0
            PathLine { x: root.width; y: 0 }
            PathLine { x: root.width; y: root.height }
            PathLine { x: 0;          y: root.height }
            PathLine { x: 0;          y: 0 }
        }

        LinearGradient {
            id: linGrad
            x1: root.width/2 - root._dx*root._L;  y1: root.height/2 - root._dy*root._L
            x2: root.width/2 + root._dx*root._L;  y2: root.height/2 + root._dy*root._L
            GradientStop { position: root._stops[0].pos; color: root._stops[0].color }
            GradientStop { position: root._stops[1].pos; color: root._stops[1].color }
            GradientStop { position: root._stops[2].pos; color: root._stops[2].color }
            GradientStop { position: root._stops[3].pos; color: root._stops[3].color }
        }
        RadialGradient {
            id: radGrad
            centerX: root.width/2;  centerY: root.height/2
            focalX:  root.width/2;  focalY:  root.height/2
            centerRadius: Math.max(root.width, root.height) / 2
            GradientStop { position: root._stops[0].pos; color: root._stops[0].color }
            GradientStop { position: root._stops[1].pos; color: root._stops[1].color }
            GradientStop { position: root._stops[2].pos; color: root._stops[2].color }
            GradientStop { position: root._stops[3].pos; color: root._stops[3].color }
        }
    }
}
