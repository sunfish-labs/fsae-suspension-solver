Attribute VB_Name = "ExportHardpoints"
' ExportHardpoints: write every reference point in the open SolidWorks part or assembly to a CSV table
' (name, x, y, z in mm) for the FSAE Suspension Solver's "Points from CAD" import.
'
' Setup, once:
'   1. Model each hardpoint as a reference point (Insert > Reference Geometry > Point) at the top level of a part
'      or assembly (a skeleton part works well). Points inside folders are fine; points inside sub-parts of an
'      assembly are not read.
'   2. Rename each point so the solver can tell what it is, for example
'        FR upper inboard front, FR upper inboard rear, FR upper ball joint,
'        FR lower inboard front, FR lower inboard rear, FR lower ball joint,
'        FR tie rod inboard, FR tie rod outboard, FR contact patch (or FR wheel center),
'        FR pushrod outboard, FR rocker pivot, FR rocker axis, FR rocker pushrod, FR rocker damper,
'        FR damper chassis
'      and the same with RR for the rear (FL / RL for left-hand points). Anything the solver can't match, you
'      can still assign by hand in the import.
'   3. Optional: a coordinate system to measure from (Insert > Reference Geometry > Coordinate System), for
'      example on the ground under the front axle on the car's centerline.
' Run: Tools > Macro > New (save as ExportHardpoints.swp), replace its code with this file's code below the
' Attribute line (or File > Import this .bas in the VBA editor), then Tools > Macro > Run.
' The CSV is written next to the model (or to the Desktop for an unsaved model). SolidWorks works in meters
' internally; the macro writes millimeters.
Option Explicit

Sub main()
    Dim swApp As SldWorks.SldWorks
    Dim swModel As SldWorks.ModelDoc2
    Set swApp = Application.SldWorks
    Set swModel = swApp.ActiveDoc
    If swModel Is Nothing Then
        MsgBox "Open the part or assembly with the hardpoints first.", vbExclamation, "Export hardpoints"
        Exit Sub
    End If

    Dim csName As String
    csName = InputBox("Coordinate system to measure from (its name in the FeatureManager tree)." & vbCrLf & _
                      "Leave blank to use the model's origin.", "Export hardpoints", "")
    Dim xf As SldWorks.MathTransform
    If Len(Trim(csName)) > 0 Then
        Set xf = swModel.Extension.GetCoordinateSystemTransformByName(Trim(csName))
        If xf Is Nothing Then
            MsgBox "No coordinate system named """ & csName & """.", vbExclamation, "Export hardpoints"
            Exit Sub
        End If
        Set xf = xf.Inverse
    End If

    Dim txt As String, n As Long
    txt = "name,x,y,z" & vbCrLf
    Dim feat As SldWorks.Feature
    Set feat = swModel.FirstFeature
    Do While Not feat Is Nothing
        txt = txt & PointsIn(feat, xf, n)
        Set feat = feat.GetNextFeature
    Loop
    If n = 0 Then
        MsgBox "No reference points found. Add them with Insert > Reference Geometry > Point.", vbExclamation, "Export hardpoints"
        Exit Sub
    End If

    Dim path As String, folder As String, base As String
    path = swModel.GetPathName
    If Len(path) = 0 Then
        folder = Environ("USERPROFILE") & "\Desktop\"
        base = "hardpoints"
    Else
        folder = Left(path, InStrRev(path, "\"))
        base = Mid(path, InStrRev(path, "\") + 1)
        If InStr(base, ".") > 0 Then base = Left(base, InStrRev(base, ".") - 1)
    End If
    Dim outFile As String, f As Integer
    outFile = folder & base & "_hardpoints.csv"
    f = FreeFile
    Open outFile For Output As #f
    Print #f, txt;
    Close #f
    MsgBox n & " points written to" & vbCrLf & outFile & vbCrLf & vbCrLf & _
           "In the solver: Open > Points from CAD, then choose this file.", vbInformation, "Export hardpoints"
End Sub

' a reference point (or the points in a folder) as CSV lines
Private Function PointsIn(feat As SldWorks.Feature, xf As SldWorks.MathTransform, n As Long) As String
    Dim s As String
    If feat.GetTypeName2 = "RefPoint" Then
        Dim rp As SldWorks.RefPoint
        Set rp = feat.GetSpecificFeature2
        Dim mp As SldWorks.MathPoint
        Set mp = rp.GetRefPoint
        If Not mp Is Nothing Then
            If Not xf Is Nothing Then Set mp = mp.MultiplyTransform(xf)
            Dim d As Variant
            d = mp.ArrayData
            s = Quote(feat.Name) & "," & Mm(d(0)) & "," & Mm(d(1)) & "," & Mm(d(2)) & vbCrLf
            n = n + 1
        End If
    End If
    PointsIn = s
End Function

' meters to millimeters with a decimal point whatever the Windows number format
Private Function Mm(v As Variant) As String
    Mm = Replace(Format(CDbl(v) * 1000#, "0.000"), ",", ".")
End Function

Private Function Quote(s As String) As String
    Quote = Replace(Replace(Replace(s, ",", " "), ";", " "), vbTab, " ")   ' keep the name in one CSV cell
End Function
